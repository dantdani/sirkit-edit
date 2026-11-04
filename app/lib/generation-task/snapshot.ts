/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4 (task-worker-contract.md sections 4 and 6.2): the PUBLIC view of a generation task -
 * the snapshot `sirkit.generation-task-snapshot.v1` every route answers and the page reads - and its LIVENESS, judged from the durable
 * store alone (never from a request being open, never invented).
 *
 *  - Liveness: `running` only while a pending slice's owner still holds an unexpired outbox lease with its own token; an owner whose
 *    lease lapsed without a commit is `lease_expired`; a due, unclaimed slice is `waiting_for_worker` inside the pickup grace, then
 *    `no_worker` when no generation slice is processing anywhere (no worker is consuming the topic) or `workers_busy` when other slices
 *    hold the workers; every pending slice delayed (Retry-After / backoff) is `scheduled`; nothing pending is `idle`. A queued task with
 *    no worker therefore reads "waiting for a worker", never "running".
 *  - The snapshot carries counts, closed-list values, instants and the head's already-redacted server sentences (milestones, blocker,
 *    activity lines). Never the conversation, a tool output, model text beyond the bounded activity lines, a credential or hidden
 *    reasoning. The prompt is included only when the caller asks for it (`GET /api/generation-tasks/[id]`, project members).
 *  - The actions are computed HERE from the state and its blocker (the page shows only these; the store still judges every control).
 *
 * Pure: no repository, no clock of its own (the caller passes `nowMs` and the processing slices it read from the store).
 */
import { GENERATION_SLICE_POLICY, GENERATION_TASK_BOUNDS, generationAllowanceLimits, generationCommitted, type GenerationTaskHead } from "./contracts";
import type { GenerationTaskActivity } from "./events";
import { isTerminalGenerationTaskState, isoOf, type GenerationQueueWaitReason, type GenerationBlockId, type GenerationBlockStatus, type GenerationBlockerCode, type GenerationFailureReason, type GenerationStrategyId, type GenerationTaskOrigin, type GenerationTaskPhase, type GenerationTaskState } from "./vocabulary";

export const GENERATION_TASK_SNAPSHOT_SCHEMA = "sirkit.generation-task-snapshot.v1" as const;

/** Section 4's liveness, from the store. */
export const GENERATION_TASK_LIVENESS = Object.freeze(["running", "lease_expired", "waiting_for_worker", "no_worker", "workers_busy", "scheduled", "idle"] as const);
export type GenerationTaskLiveness = (typeof GENERATION_TASK_LIVENESS)[number];

/** The control actions a snapshot may list (the control route's vocabulary; `extend-allowance` is a resume with one more unit). */
export const GENERATION_TASK_SNAPSHOT_ACTIONS = Object.freeze(["cancel", "pause", "resume", "extend-allowance", "retry-block", "review-partial", "record-review", "report-base"] as const);
export type GenerationTaskSnapshotAction = (typeof GENERATION_TASK_SNAPSHOT_ACTIONS)[number];

/** A processing outbox event of the slice topic, as the store lists it (global: bounded by workers x concurrency). */
export interface GenerationProcessingSlice { sliceId: string; leaseToken: string | null; leaseExpiresAt: string | null; /** [PR-L6 integration, 2026-10-19] F7: the claiming worker (`generationScopedClaimOwner` marks a --scope worker) */ leaseOwner?: string | null }

export interface GenerationTaskLivenessView {
  state: GenerationTaskLiveness;
  /** when the current wait began (the oldest due slice's `notBefore`), or null */
  since: string | null;
  /** when a delayed slice is due (`scheduled`), or null */
  retryAt: string | null;
}

export interface GenerationTaskSnapshotBlock {
  blockId: GenerationBlockId;
  name: string;
  status: GenerationBlockStatus;
  strategy: GenerationStrategyId;
  turnsUsed: number;
  blocker: GenerationBlockerCode | null;
  /** [PR-L6, 2026-10-19] only when the block waits for parts its searches could not find (L.6 part 2, item 8): the roles, bounded lines */
  missing?: Array<{ role: string; query: string; category: string | null }>; /** [PR-J, 2026-11-04] J7-2: only while the block is queued again because live siblings' reservations fill the allowance (`allowance`); on this line so no cited line moves */ waiting?: GenerationQueueWaitReason;
}

export interface GenerationTaskSnapshot {
  schema: typeof GENERATION_TASK_SNAPSHOT_SCHEMA;
  taskId: string;
  clientRequestId: string;
  scope: { tenantId: string; projectId: string; branchId: string };
  state: GenerationTaskState;
  terminal: boolean;
  phase: GenerationTaskPhase | null;
  origin: GenerationTaskOrigin;
  provider: string;
  createdAt: string;
  updatedAt: string;
  /** the server's task clock when the snapshot was taken (elapsed time = serverNow - createdAt; no browser clock involved) */
  serverNow: string;
  liveness: GenerationTaskLivenessView;
  /** [PR-L6, 2026-10-19] `coverage` only when the planner listed it (OD-253 item 3) */
  plan: { planner: string; rationale: string; assumptions: string[]; coverage?: string[]; blocks: GenerationTaskSnapshotBlock[] } | null;
  blocker: { code: GenerationBlockerCode; message: string; resolution: string; blockId: GenerationBlockId | null } | null;
  failure: { reason: GenerationFailureReason; at: string } | null;
  usage: { slices: number; attempts: number; modelCalls: number; uncertainModelCalls: number; inputTokens: number; outputTokens: number; catalogSearches: number; cacheHits: number };
  /** [PR-L6, 2026-10-19] `remaining.inputTokens` only when the task's unit has an input dimension (an operator unit, OD-253 item 6) */
  allowance: { units: number; extensions: number; maxExtensions: number; remaining: { modelCalls: number; outputTokens: number; catalogSearches: number; inputTokens?: number }; windowEndsAt: string };
  base: { schematicDigest: string; recipe: string; moved: boolean };
  result: { status: "complete" | "partial"; omittedBlocks: string[]; resultDigest: string } | null;
  review: { outcome: "applied" | "discarded"; at: string } | null;
  control: { cancelRequested: boolean; pauseRequested: boolean };
  actions: GenerationTaskSnapshotAction[];
  /** the blocks `retry-block` may name */
  retryBlocks: GenerationBlockId[];
  /** the ordered milestone cursor (`seq` of the newest milestone) */
  eventCursor: number;
  /** the live activity of the current owners (display data, already redacted server lines), newest last */
  activity: Array<{ at: string; text: string }>;
  /** only when asked for (GET /api/generation-tasks/[id]) */
  prompt?: string;
}

/** Section 4's liveness judgement. */
export function generationTaskLiveness(head: GenerationTaskHead, input: { nowMs: number; processing: readonly GenerationProcessingSlice[]; pickupGraceMs?: number }): GenerationTaskLivenessView {
  const pending = Object.entries(head.pending);
  if (pending.length === 0) return { state: "idle", since: null, retryAt: null };
  const liveLease = (event: GenerationProcessingSlice): boolean => Date.parse(event.leaseExpiresAt ?? "") > input.nowMs;
  const owned = pending.filter(([, entry]) => entry.owner !== null);
  if (owned.some(([id, entry]) => input.processing.some((event) => event.sliceId === id && event.leaseToken === entry.owner!.leaseToken && liveLease(event)))) return { state: "running", since: null, retryAt: null };
  if (owned.length > 0) {
    const since = owned.map(([, entry]) => entry.owner!.claimedAt).sort()[0]!;
    return { state: "lease_expired", since, retryAt: null };
  }
  const due = pending.filter(([, entry]) => Date.parse(entry.notBefore) <= input.nowMs);
  if (due.length === 0) return { state: "scheduled", since: null, retryAt: pending.map(([, entry]) => entry.notBefore).sort()[0]! };
  const since = due.map(([, entry]) => entry.notBefore).sort()[0]!;
  if (input.nowMs - Date.parse(since) < (input.pickupGraceMs ?? GENERATION_SLICE_POLICY.workerPickupGraceMs)) return { state: "waiting_for_worker", since, retryAt: null };
  return { state: input.processing.some((event) => liveLease(event) && claimOwnerServes(event.leaseOwner, head.scope)) ? "workers_busy" : "no_worker", since, retryAt: null }; // [PR-L6 integration, 2026-10-19] F7: a worker restricted to ANOTHER scope never claims this task's slices
}

const ALLOWANCE_BLOCKERS: readonly GenerationBlockerCode[] = ["allowance_exhausted", "task_window_elapsed"];
const BLOCK_BLOCKERS: readonly GenerationBlockerCode[] = ["missing_part", "no_progress", "missing_evidence", "partial_available"];

/** The control actions valid NOW (the page shows only these; the store judges each again). */
export function generationTaskActions(head: GenerationTaskHead): { actions: GenerationTaskSnapshotAction[]; retryBlocks: GenerationBlockId[] } {
  const blocks = Object.values(head.blocks).filter((block): block is NonNullable<typeof block> => Boolean(block));
  const retryBlocks = blocks.filter((block) => block.status === "blocked" || block.status === "needs-revalidation").map((block) => block.blockId);
  const saved = blocks.some((block) => block.status === "saved");
  switch (head.state) {
    case "queued": case "running": case "waiting-for-provider": return { actions: ["cancel", "pause"], retryBlocks: [] };
    case "paused": return { actions: ["cancel", "resume"], retryBlocks: [] };
    case "waiting-for-resource": {
      const code = head.blocker?.code ?? null;
      const actions: GenerationTaskSnapshotAction[] = ["cancel"];
      // [PR-L6, 2026-10-19] saved blocks beside a block the allowance stopped (partial_available, cause allowance_exhausted or
      // task_window_elapsed): retrying that block would be refused at its claim again, so the way on is another allowance
      const cause = head.blocker?.evidence.cause;
      const allowanceCause = code === "partial_available" && typeof cause === "string" && (ALLOWANCE_BLOCKERS as readonly string[]).includes(cause);
      if (code !== null && (ALLOWANCE_BLOCKERS.includes(code) || allowanceCause)) { if (head.allowance.extensions.length < GENERATION_TASK_BOUNDS.extensions) actions.push("extend-allowance"); }
      else if (code !== null && BLOCK_BLOCKERS.includes(code)) { if (retryBlocks.length) actions.push("retry-block"); }
      else actions.push("resume");
      if (saved) actions.push("review-partial");
      return { actions, retryBlocks: actions.includes("retry-block") ? retryBlocks : [] };
    }
    case "awaiting-review": return { actions: ["record-review", "report-base"], retryBlocks: [] };
    default: return { actions: [], retryBlocks: [] };
  }
}

/** The public snapshot of a validated head. */
export function buildGenerationTaskSnapshot(head: GenerationTaskHead, input: { nowMs: number; processing: readonly GenerationProcessingSlice[]; activity?: readonly GenerationTaskActivity[]; includePrompt?: boolean; pickupGraceMs?: number }): GenerationTaskSnapshot {
  const limits = generationAllowanceLimits(head.allowance), committed = generationCommitted(head);
  const { actions, retryBlocks } = generationTaskActions(head);
  const activity = [...(input.activity ?? [])].flatMap((entry) => entry.lines).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).slice(-8).map((entry) => ({ at: entry.at, text: entry.text }));
  const plan = head.plan
    ? {
      planner: head.plan.planner.state, rationale: head.plan.rationale, assumptions: [...head.plan.assumptions], ...(head.plan.coverage?.length ? { coverage: [...head.plan.coverage] } : {}),
      blocks: head.plan.blocks.map((planned) => {
        const block = head.blocks[planned.blockId]!;
        return { blockId: block.blockId, name: block.name, status: block.status, strategy: block.strategy, turnsUsed: block.turnsUsed, blocker: block.blocker, ...(block.missing?.length ? { missing: block.missing.map((entry) => ({ ...entry })) } : {}), ...queueWaitOf(head, block.blockId) }; // [PR-J, 2026-11-04] J7-2
      }),
    }
    : null;
  return {
    schema: GENERATION_TASK_SNAPSHOT_SCHEMA,
    taskId: head.taskId,
    clientRequestId: head.request.clientRequestId,
    scope: { ...head.scope },
    state: head.state,
    terminal: isTerminalGenerationTaskState(head.state),
    phase: head.phase,
    origin: head.initiator.origin,
    provider: head.request.provider,
    createdAt: head.createdAt,
    updatedAt: head.updatedAt,
    serverNow: isoOf(input.nowMs),
    liveness: generationTaskLiveness(head, input),
    plan,
    blocker: head.blocker ? { code: head.blocker.code, message: head.blocker.message, resolution: head.blocker.resolution, blockId: head.blocker.blockId } : null,
    failure: head.failure ? { ...head.failure } : null,
    usage: { slices: head.usage.slices, attempts: head.usage.attempts, modelCalls: head.usage.modelCalls, uncertainModelCalls: head.usage.uncertainModelCalls, inputTokens: head.usage.inputTokens, outputTokens: head.usage.outputTokens, catalogSearches: head.usage.catalogSearches, cacheHits: head.usage.cacheHits },
    allowance: {
      units: head.allowance.units, extensions: head.allowance.extensions.length, maxExtensions: GENERATION_TASK_BOUNDS.extensions,
      remaining: { modelCalls: Math.max(0, limits.modelCalls - committed.modelCalls), outputTokens: Math.max(0, limits.outputTokens - committed.outputTokens), catalogSearches: Math.max(0, limits.catalogSearches - head.usage.catalogSearches), ...(limits.inputTokens !== undefined ? { inputTokens: Math.max(0, limits.inputTokens - committed.inputTokens) } : {}) },
      windowEndsAt: isoOf(Date.parse(head.createdAt) + limits.wallClockMs),
    },
    base: { schematicDigest: head.base.schematicDigest, recipe: head.base.recipe, moved: head.base.moved },
    result: head.result ? { status: head.result.status, omittedBlocks: [...head.result.omittedBlocks], resultDigest: head.result.resultDigest } : null,
    review: head.review ? { outcome: head.review.outcome, at: head.review.at } : null,
    control: { cancelRequested: head.control.cancel !== null, pauseRequested: head.control.pause !== null },
    actions,
    retryBlocks,
    eventCursor: head.eventSeq,
    activity,
    ...(input.includePrompt ? { prompt: head.request.prompt } : {}),
  };
}

// [PR-L6 integration, 2026-10-19] F7 (the engine review of increment 6), appended after the last line (declarations are hoisted): since
// increment 6 a worker may run with `--scope` and claim only that scope's slices, so "a live lease exists" no longer means a due slice of
// THIS task will be picked up. A scope-restricted worker claims under an owner id that names its scope's tag; the liveness judgement counts
// a live lease toward `workers_busy` only when its worker is unrestricted or restricted to the task's own scope - otherwise `no_worker`.
import { canonicalDurableScope, durableWorkflowDigest } from "../durable-workflow/stable";
/** Between a worker id ([A-Za-z0-9._:-], so never containing "#") and its scope tag: an unambiguous mark. */
export const GENERATION_SCOPED_OWNER_MARK = "#scope:";
/** A scope's 16-hex tag (the canonical tenant, project and branch). */
export function generationWorkerScopeTag(scope: { tenantId: string; projectId: string; branchId: string }): string {
  return durableWorkflowDigest({ schema: "sirkit.generation-worker-scope.v1", ...canonicalDurableScope(scope) }).slice(4, 20);
}
/** The owner id a `--scope` worker claims generation slices under (the outbox lease owner and the head's slice owner; at most 151 characters). */
export function generationScopedClaimOwner(workerId: string, scope: { tenantId: string; projectId: string; branchId: string }): string {
  return `${workerId}${GENERATION_SCOPED_OWNER_MARK}${generationWorkerScopeTag(scope)}`;
}
/** Whether the worker holding a lease could claim a slice of `scope`: an unmarked (or unknown) owner is unrestricted. */
function claimOwnerServes(owner: string | null | undefined, scope: { tenantId: string; projectId: string; branchId: string }): boolean {
  const at = typeof owner === "string" ? owner.lastIndexOf(GENERATION_SCOPED_OWNER_MARK) : -1;
  return at < 0 || owner!.slice(at + GENERATION_SCOPED_OWNER_MARK.length) === generationWorkerScopeTag(scope);
}

// [PR-J, 2026-11-04] Runbook J.7, increment J7-2 (allowance contention), appended after the last line (a function declaration is hoisted):
// the per-block signal of a block queued again because live siblings' held reservations fill the task's allowance - read from the head's
// own pending entry (an unowned slice of the block carrying `wait`), so the card never calls that wait "a free worker slot".
function queueWaitOf(head: GenerationTaskHead, block: GenerationBlockId): { waiting?: GenerationQueueWaitReason } {
  const entry = Object.values(head.pending).find((pending) => pending.blockId === block && pending.owner === null && pending.wait !== undefined);
  return entry?.wait ? { waiting: entry.wait.reason } : {};
}
