/**
 * [PR-M, 2026-10-18] Section M2 (runbook M.4, design M2.3): the DURABLE component-resolution task's head - aggregate
 * `component-resolution.task.v1` on the SAME durable repository and outbox as the generation task, its slices on their own topic
 * `component-resolution-slice`, consumed by the EXISTING generation worker (app/lib/generation-task/worker/worker.ts registers the topic;
 * there is no second worker). States reuse the generation task's vocabulary; stages are M.4's distinct steps with their own evidence.
 *
 * The head captures what every asynchronous boundary re-checks (M.4): the target instances' stable ids, the schematic base digest and
 * head mark, the initiator's membership revision, the candidate and report digests, the handoff, the publication, the proposal.
 */
import type { DurableWorkflowScope } from "../../durable-workflow/types";
import type { SchematicCanonicalMark } from "../../engineering/schematic-projection";
import type { ProjectRole } from "../../engineering/types";
import type { SchematicInstanceFacts } from "../instance-facts";
import type { AcquisitionTarget } from "../acquisition/candidate";
import type { PipelineAttempt } from "../acquisition/pipeline";
import {
  CAD_ACQUISITION_BLOCKER_TEXT, CAD_ACQUISITION_STAGES, CAD_ACQUISITION_TASK_SCHEMA,
  type CadAcquisitionBlockerCode, type CadAcquisitionEvent, type CadAcquisitionEventKind, type CadAcquisitionRequest, type CadAcquisitionStage, type CadAcquisitionStageStatus, type CadAcquisitionState, type CadAcquisitionTaskView,
} from "../../acquisition/cad-acquisition-contract";

export const COMPONENT_RESOLUTION_TASK_AGGREGATE = "component-resolution.task.v1" as const;
export const COMPONENT_RESOLUTION_SLICE_TOPIC = "component-resolution-slice" as const;
export const COMPONENT_RESOLUTION_SLICE_EVENT = "component-resolution.slice" as const;
export const COMPONENT_RESOLUTION_SLICE_CONTRACT = "sirkit.component-resolution-slice.v1" as const;
export const COMPONENT_RESOLUTION_SCOPE_SUFFIX = "component-resolution-tasks" as const;
export const COMPONENT_RESOLUTION_TASK_ID = /^cr-task:[0-9a-f]{32}$/;
export const COMPONENT_RESOLUTION_SLICE_ID = /^cr-task:[0-9a-f]{32}:s[0-9]{1,4}$/;
export type ComponentResolutionSliceKind = "acquire" | "recheck";

/** Slice and wait policy: finite slices; a review wait is re-checked with backoff, at most `maxScheduledRechecks` times, then on Resume. */
export const COMPONENT_RESOLUTION_POLICY = Object.freeze({
  leaseMs: 60_000,
  maxAttemptsPerSlice: 3,
  firstRecheckMs: 15_000,
  maxRecheckMs: 15 * 60_000,
  maxScheduledRechecks: 12,
  maxEvents: 64,
  maxAttempts: 16,
  claimRetries: 3,
});

export interface ComponentResolutionTaskHead {
  schema: typeof CAD_ACQUISITION_TASK_SCHEMA;
  taskId: string;
  scope: DurableWorkflowScope;
  initiator: { principalId: string; role: ProjectRole; membershipRevision: string | null; actorKind: "human" | "ai" };
  origin: "page" | "chat";
  request: CadAcquisitionRequest & { requirementDigest: string };
  base: { schematicDigest: string; headMark: SchematicCanonicalMark | null };
  target: AcquisitionTarget;
  /** the instances' facts as the server read them at start (pins from the server catalog, nets from the verified sheet) */
  instances: SchematicInstanceFacts[];
  state: CadAcquisitionState;
  stage: CadAcquisitionStage;
  stages: Record<CadAcquisitionStage, { status: CadAcquisitionStageStatus; at: string | null; evidence: string | null }>;
  attempts: PipelineAttempt[];
  candidateId: string | null;
  candidate: CadAcquisitionTaskView["candidate"];
  handoff: CadAcquisitionTaskView["handoff"];
  publication: CadAcquisitionTaskView["publication"];
  proposal: CadAcquisitionTaskView["proposal"];
  applied: CadAcquisitionTaskView["applied"];
  preflight: CadAcquisitionTaskView["preflight"];
  blocker: CadAcquisitionTaskView["blocker"];
  pending: null | { sliceId: string; kind: ComponentResolutionSliceKind; notBefore: string; owner: null | { attempt: number; fence: number; workerId: string; leaseToken: string; claimedAt: string } };
  sliceCounter: number;
  fenceCounter: number;
  recheckCount: number;
  control: { cancel: null | { at: string; by: string }; applied: Array<{ key: string; action: string; at: string }> };
  events: CadAcquisitionEvent[];
  nextSeq: number;
  createdAt: string;
  updatedAt: string;
}

export function emptyStages(): ComponentResolutionTaskHead["stages"] {
  return Object.fromEntries(CAD_ACQUISITION_STAGES.map((stage) => [stage, { status: "pending", at: null, evidence: null }])) as ComponentResolutionTaskHead["stages"];
}

/** Append one public progress event (bounded; the oldest fall off). */
export function pushEvent(head: ComponentResolutionTaskHead, kind: CadAcquisitionEventKind, at: string, message: string, data?: CadAcquisitionEvent["data"]): void {
  head.events = [...head.events, { seq: head.nextSeq, at, kind, message, ...(data ? { data } : {}) }].slice(-COMPONENT_RESOLUTION_POLICY.maxEvents);
  head.nextSeq += 1;
}

export function setStage(head: ComponentResolutionTaskHead, stage: CadAcquisitionStage, status: CadAcquisitionStageStatus, at: string, evidence: string | null): void {
  head.stages[stage] = { status, at, evidence: evidence === null ? null : evidence.slice(0, 600) };
  if (status === "running" || status === "awaiting" || status === "done" || status === "blocked") head.stage = stage; // [PR-L/M integration, 2026-10-18] + "awaiting" (a stage waiting for a person is the current stage)
}

export function blockerOf(code: CadAcquisitionBlockerCode, detail: string | null): NonNullable<ComponentResolutionTaskHead["blocker"]> {
  const text = CAD_ACQUISITION_BLOCKER_TEXT[code];
  return { code, message: text.message, remedy: text.remedy, draftOffered: text.draftOffered, detail: detail === null ? null : detail.slice(0, 400) };
}

export function isTerminalResolutionState(state: CadAcquisitionState): boolean {
  return state === "cancelled" || state === "succeeded" || state === "failed" || state === "stale";
}

/** The public view (what the route, the status read and the page show). */
export function componentResolutionTaskView(head: ComponentResolutionTaskHead): CadAcquisitionTaskView {
  const nextAction: CadAcquisitionTaskView["nextAction"] = isTerminalResolutionState(head.state) ? "none"
    : head.proposal && !head.applied ? "offer-replacement"
    : head.handoff && !head.proposal ? "await-publication"
    : head.candidate && head.candidate.verdict === "validated" && !head.handoff && head.state === "awaiting-review" ? "send-for-review"
    : head.pending ? "wait" : "none";
  return structuredClone({
    schema: head.schema, taskId: head.taskId, state: head.state, stage: head.stage,
    stages: CAD_ACQUISITION_STAGES.map((stage) => ({ stage, ...head.stages[stage] })),
    targets: head.instances.map((instance) => ({ componentId: instance.componentId, refDes: instance.refDes, value: instance.value, catalogPartId: head.target.catalogPartId, symbol: `${head.target.symbol.library}:${head.target.symbol.name}`, footprint: head.target.footprint ? `${head.target.footprint.library}:${head.target.footprint.name}` : null, exactMpn: head.target.exactMpn })),
    requirement: head.request.requirement, attempts: head.attempts, candidate: head.candidate, handoff: head.handoff, publication: head.publication, proposal: head.proposal,
    applied: head.applied, preflight: head.preflight, blocker: head.blocker, nextAction, events: head.events, createdAt: head.createdAt, updatedAt: head.updatedAt,
  });
}
