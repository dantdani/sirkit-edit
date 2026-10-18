/**
 * [PR-D] The SAFE receiver of the agent's Build-mode generation. [PR-L, 2026-10-18] Runbook L.5, increment 5 (task-worker-contract.md
 * section 8): the chat's generation is the project's DURABLE generation task, so the page receives two events, neither of which is a
 * design and neither of which grants anything:
 *
 *  - `generation_task_ready` (`sirkit.schematic.generate-proposal@2.0.0`): a task REFERENCE (`sirkit.generation-task-ref.v1`). The page
 *    re-reads the task through its own authorized `GET /api/generation-tasks/[id]` and follows it with the SAME status card and the SAME
 *    review intake as a Build start (attachGenerationTask -> offerGenerationTaskResult -> offerBuildResult -> the schematic review
 *    dialog), once per (task, result digest). `generationTaskAttachDecision` is that rule, pure.
 *  - `generation_task_control_ready` (`sirkit.generation.task-control`): a SEALED control request the page shows as a confirm chip; only
 *    the human's click sends its action to the task's control route (`POST /api/generation-tasks/[id]/control`), where the human is
 *    authorized and the store judges the transition. `generationTaskControlCurrency` checks the chip against the live page.
 *
 * The v1 receiver of `generation_proposal_ready` (an in-turn design sealed inside the chat run) is removed with its producer: nothing
 * emits it any more. A fabricated, altered, malformed or foreign event yields null / a refusal and offers nothing. Pure and node-free;
 * freely importable (the consumer never imports the services or the gateway).
 */
import {
  GENERATION_TASK_CONTROL_SCHEMA, GENERATION_TASK_REF_SCHEMA, readGenerationTaskReference, verifySealedGenerationTaskControlRequest,
  type GenerationTaskReference, type SealedGenerationTaskControlRequest,
} from "../agent/generation-task-tools";

export interface ReceivedGenerationTask {
  task: GenerationTaskReference;
  /** audit metadata only (never authority): the run that started or attached it */
  runId: string | null;
}
export interface ReceivedGenerationTaskControl {
  request: SealedGenerationTaskControlRequest;
  runId: string | null;
}

const runIdOf = (value: unknown): string | null => (typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null);

/** Narrow an agent `generation_task_ready` event payload without granting anything (the reference is re-read from the server). */
export function receiveGenerationTaskEvent(event: { type?: unknown; runId?: unknown; task?: unknown; [key: string]: unknown } | null | undefined): ReceivedGenerationTask | null {
  if (!event || typeof event !== "object" || event.type !== "generation_task_ready") return null;
  const task = readGenerationTaskReference(event.task);
  if (!task || task.schema !== GENERATION_TASK_REF_SCHEMA) return null;
  return { task, runId: runIdOf(event.runId) };
}

/** Narrow an agent `generation_task_control_ready` event payload: a structurally verified sealed control request or nothing. */
export function receiveGenerationTaskControlEvent(event: { type?: unknown; runId?: unknown; request?: unknown; [key: string]: unknown } | null | undefined): ReceivedGenerationTaskControl | null {
  if (!event || typeof event !== "object" || event.type !== "generation_task_control_ready") return null;
  const request = event.request;
  if (typeof request !== "object" || request === null || Array.isArray(request) || (request as { schema?: unknown }).schema !== GENERATION_TASK_CONTROL_SCHEMA) return null;
  if (!verifySealedGenerationTaskControlRequest(request).ok) return null;
  return { request: request as SealedGenerationTaskControlRequest, runId: runIdOf(event.runId) };
}

/** What the page does with a received task reference, given what it already follows and holds (pure; the page's `case` runs it). */
export type GenerationTaskAttachDecision =
  | { kind: "foreign"; detail: string }
  | { kind: "already-followed"; detail: string }
  | { kind: "already-offered"; detail: string }
  | { kind: "attach" };

export function generationTaskAttachDecision(task: GenerationTaskReference, live: { projectId: string | null; branchId: string; followedTaskId: string | null; pendingTask: { taskId: string; resultDigest: string } | null }): GenerationTaskAttachDecision {
  if (!live.projectId || task.scope.projectId !== live.projectId || task.scope.branchId !== live.branchId) return { kind: "foreign", detail: "the design task belongs to another project or branch; this page follows nothing for it." };
  if (live.followedTaskId === task.taskId) return { kind: "already-followed", detail: "this page already follows that design task; its status card below shows it." };
  if (live.pendingTask && live.pendingTask.taskId === task.taskId && (!task.result || task.result.resultDigest === live.pendingTask.resultDigest)) return { kind: "already-offered", detail: "that design's result is already waiting in the review dialog." };
  return { kind: "attach" };
}

export type GenerationTaskControlCurrency = { ok: true } | { ok: false; code: "foreign-scope" | "expired"; detail: string };

/** The chip's currency against the live page: this project and branch, unexpired. The action's validity is the control route's. */
export function generationTaskControlCurrency(request: SealedGenerationTaskControlRequest, live: { projectId: string | null; branchId: string; now: number }): GenerationTaskControlCurrency {
  if (!live.projectId || request.scope.projectId !== live.projectId || request.scope.branchId !== live.branchId) return { ok: false, code: "foreign-scope", detail: "the control request was made for another project or branch; nothing was sent." };
  if (!(request.expiresAt > live.now)) return { ok: false, code: "expired", detail: "the control request expired before it was confirmed; ask again. Nothing was sent." };
  return { ok: true };
}

/** The confirm chip's card: one review card per request (its id prefix keys the page's buttons). */
export const GENERATION_TASK_CONTROL_CARD_ID_PREFIX = "generation-task-control:";
export function generationTaskControlCardLines(request: SealedGenerationTaskControlRequest): { title: string; lines: string[] } {
  return {
    title: `The assistant asks: ${request.label}`,
    lines: [
      `For this project's design task (${request.taskId.slice("generation-task:".length, "generation-task:".length + 8)}…), which was ${request.stateAtRequest} when asked.`,
      "Nothing happens to the design until you confirm; the server checks the action again then. Dismiss sends nothing.",
    ],
  };
}
