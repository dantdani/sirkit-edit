/**
 * [PR-L, 2026-10-17] Runbook L.2/L.4, increment 2: the PUBLIC progress of a generation task (task-worker-contract.md section 6.3).
 *
 *  - Milestones `sirkit.generation-task-event.v1` are durable and ordered: appended ONLY by head commits (the task head's `milestones`
 *    ring, at most 48, and its monotonic `eventSeq`), so a reader's cursor is the `seq` it last saw and a replay after a reconnect is
 *    exact. A cursor older than the ring answers `gap: true` (the caller shows the snapshot); a cursor ahead of the task is refused the
 *    same way, never trusted.
 *  - Each type carries a CLOSED data shape of counts, closed-list values and instants only; the message is a server sentence through
 *    the run-event redactor (`boundedRunEventText`), at most 240 characters, one line. No model reasoning, tool output, prompt,
 *    credential or provider payload is ever an event: a builder takes server text and refuses any value outside its shape.
 *  - Live activity (`sirkit.generation-task-activity.v1`, the current attempt's last 8 lines, at most 4 KB) is display data replaced as
 *    it updates; it is not part of the ordered cursor.
 */
import {
  GENERATION_BLOCKER_CODES, GENERATION_FAILURE_REASONS, GENERATION_REVIEW_OUTCOMES, GENERATION_SLICE_KINDS, GENERATION_STRATEGIES, GENERATION_TASK_ORIGINS, GENERATION_TASK_PHASES, GENERATION_WAITING_REASONS,
  GenerationTaskContractError, arrayOf, blockId, cleanLine, count, isPlainRecord, isoInstant, keysIssue, line, nullable, oneOf, shape, sliceId, taskId,
  type GenerationBlockId, type GenerationTaskPhase, type Issue, type Judge,
} from "./vocabulary";
import { LLM_PROVIDER_IDS } from "../llm/types";

export const GENERATION_TASK_EVENT_SCHEMA = "sirkit.generation-task-event.v1" as const;
export const GENERATION_TASK_ACTIVITY_SCHEMA = "sirkit.generation-task-activity.v1" as const;
export const GENERATION_TASK_EVENT_BOUNDS = Object.freeze({
  /** the head's milestone ring */
  ringSize: 48,
  messageChars: 240,
  /** one events page */
  pageLimit: 50,
  activityLines: 8,
  activityLineChars: 160,
});

export const GENERATION_TASK_EVENT_TYPES = Object.freeze(["task_accepted", "worker_claimed", "plan_ready", "block_started", "block_saved", "slice_yielded", "waiting_provider", "waiting_resource", "strategy_changed", "merge_started", "validation_result", "result_ready", "paused", "resumed", "cancel_requested", "cancelled", "stale", "review_recorded", "failed"] as const);
export type GenerationTaskEventType = (typeof GENERATION_TASK_EVENT_TYPES)[number];

const ERC_STATES = ["passed", "findings", "skipped", "not_run"] as const;
const PLANNER_STATES = ["planned", "single", "failed_fallback"] as const;
const RESULT_STATUSES = ["complete", "partial"] as const;
const small = count(1_000_000);

/** Each type's CLOSED data shape. */
const DATA: Readonly<Record<GenerationTaskEventType, Readonly<Record<string, Judge>>>> = Object.freeze({
  task_accepted: { origin: oneOf(GENERATION_TASK_ORIGINS), provider: oneOf(LLM_PROVIDER_IDS) },
  worker_claimed: { sliceKind: oneOf(GENERATION_SLICE_KINDS), attempt: small },
  plan_ready: { blocks: count(8), planner: oneOf(PLANNER_STATES) },
  block_started: { strategy: oneOf(GENERATION_STRATEGIES), turnsUsed: small },
  block_saved: { turnsUsed: small, partsSurfaced: small },
  slice_yielded: { sliceKind: oneOf(GENERATION_SLICE_KINDS), turns: small },
  waiting_provider: { reason: oneOf(GENERATION_WAITING_REASONS), retryAt: isoInstant },
  waiting_resource: { code: oneOf(GENERATION_BLOCKER_CODES) },
  strategy_changed: { from: oneOf(GENERATION_STRATEGIES), to: oneOf(GENERATION_STRATEGIES) },
  merge_started: { blocks: count(8) },
  validation_result: { erc: oneOf(ERC_STATES), critical: small, warnings: small, sharedNetFindings: small },
  result_ready: { status: oneOf(RESULT_STATUSES), omitted: count(8) },
  paused: {},
  resumed: {},
  cancel_requested: {},
  cancelled: {},
  stale: {},
  review_recorded: { outcome: oneOf(GENERATION_REVIEW_OUTCOMES) },
  failed: { reason: oneOf(GENERATION_FAILURE_REASONS) },
});

export type GenerationTaskEventData = Record<string, string | number>;
export interface GenerationTaskEvent {
  seq: number;
  at: string;
  type: GenerationTaskEventType;
  phase: GenerationTaskPhase | null;
  blockId: GenerationBlockId | null;
  message: string;
  data: GenerationTaskEventData;
}
/** What a builder takes: everything but the `seq` the head assigns. */
export type GenerationTaskEventDraft = Omit<GenerationTaskEvent, "seq">;

const EVENT_KEYS = ["seq", "at", "type", "phase", "blockId", "message", "data"] as const;

/** The first rule an event breaks, or null. Never throws. */
export function generationTaskEventIssue(event: unknown, path = "event"): Issue {
  if (!isPlainRecord(event)) return `${path}: an object is required`;
  const keys = keysIssue(event, path, EVENT_KEYS);
  if (keys) return keys;
  const type = event.type;
  if (typeof type !== "string" || !(GENERATION_TASK_EVENT_TYPES as readonly string[]).includes(type)) return `${path}.type: outside the closed list`;
  const issue = count(Number.MAX_SAFE_INTEGER, 1)(event.seq, `${path}.seq`) ?? isoInstant(event.at, `${path}.at`) ?? nullable(oneOf(GENERATION_TASK_PHASES))(event.phase, `${path}.phase`)
    ?? nullable(blockId)(event.blockId, `${path}.blockId`) ?? line(GENERATION_TASK_EVENT_BOUNDS.messageChars, 1)(event.message, `${path}.message`);
  if (issue) return issue;
  return shape(DATA[type as GenerationTaskEventType])(event.data, `${path}.data`);
}

/** Build one event draft: the message bounded and redacted, the data judged against its type's closed shape (a refusal throws). */
export function generationTaskEvent(type: GenerationTaskEventType, input: { at: string; phase?: GenerationTaskPhase | null; blockId?: GenerationBlockId | null; message: string; data?: GenerationTaskEventData }): GenerationTaskEventDraft {
  const draft: GenerationTaskEventDraft = { at: input.at, type, phase: input.phase ?? null, blockId: input.blockId ?? null, message: cleanLine(input.message, GENERATION_TASK_EVENT_BOUNDS.messageChars), data: { ...(input.data ?? {}) } };
  const issue = generationTaskEventIssue({ seq: 1, ...draft });
  if (issue) throw new GenerationTaskContractError("GENERATION_TASK_EVENT_INVALID", issue);
  return draft;
}

/** Append drafts to a head's ring: consecutive `seq` after `eventSeq`, the oldest dropped past the ring size. Pure. */
export function appendGenerationTaskEvents(state: { milestones: readonly GenerationTaskEvent[]; eventSeq: number }, drafts: readonly GenerationTaskEventDraft[]): { milestones: GenerationTaskEvent[]; eventSeq: number } {
  let seq = state.eventSeq;
  const appended = drafts.map((draft) => ({ ...structuredClone(draft), seq: (seq += 1) }));
  const milestones = [...structuredClone(state.milestones as GenerationTaskEvent[]), ...appended];
  return { milestones: milestones.slice(Math.max(0, milestones.length - GENERATION_TASK_EVENT_BOUNDS.ringSize)), eventSeq: seq };
}

/** The ring's own invariants: each event valid, `seq` consecutive, the last one equal to `eventSeq`, at most the ring size. */
export function generationTaskMilestonesIssue(milestones: unknown, eventSeq: unknown, path = "head"): Issue {
  const seqIssue = count()(eventSeq, `${path}.eventSeq`);
  if (seqIssue) return seqIssue;
  const listIssue = arrayOf((value, at) => generationTaskEventIssue(value, at), GENERATION_TASK_EVENT_BOUNDS.ringSize)(milestones, `${path}.milestones`);
  if (listIssue) return listIssue;
  const list = milestones as GenerationTaskEvent[];
  for (let index = 1; index < list.length; index += 1) if (list[index]!.seq !== list[index - 1]!.seq + 1) return `${path}.milestones: seq must be consecutive`;
  if (list.length > 0 && list.at(-1)!.seq !== eventSeq) return `${path}.eventSeq: must equal the last milestone's seq`;
  if (list.length === 0 && eventSeq !== 0) return `${path}.eventSeq: no milestone, so it must be 0`;
  return null;
}

export interface GenerationTaskEventsPage {
  events: GenerationTaskEvent[];
  /** the cursor to send next (`after`) */
  cursor: number;
  /** more events past this page */
  hasMore: boolean;
  /** the cursor fell outside the ring (older than its oldest event, or ahead of the task): show the snapshot, then resume here */
  gap: boolean;
}
/** One bounded page of milestones after `after` (0 = from the start). Pure; the caller has loaded and validated the head. */
export function generationTaskEventsPage(state: { milestones: readonly GenerationTaskEvent[]; eventSeq: number }, input: { after?: number; limit?: number } = {}): GenerationTaskEventsPage {
  const limit = Math.min(Math.max(1, Math.floor(input.limit ?? GENERATION_TASK_EVENT_BOUNDS.pageLimit)), GENERATION_TASK_EVENT_BOUNDS.pageLimit);
  const after = Number.isSafeInteger(input.after) && (input.after as number) >= 0 ? (input.after as number) : 0;
  const ring = state.milestones;
  if (after > state.eventSeq) return { events: [], cursor: state.eventSeq, hasMore: false, gap: true };
  const oldest = ring.length ? ring[0]!.seq : state.eventSeq + 1;
  const gap = after + 1 < oldest && after < state.eventSeq;
  const pending = ring.filter((event) => event.seq > after);
  const events = structuredClone(pending.slice(0, limit) as GenerationTaskEvent[]);
  return { events, cursor: events.length ? events.at(-1)!.seq : Math.max(after, gap ? oldest - 1 : after), hasMore: pending.length > events.length, gap };
}

// ─── Live activity ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface GenerationTaskActivityLine { at: string; text: string }
export interface GenerationTaskActivity {
  schema: typeof GENERATION_TASK_ACTIVITY_SCHEMA;
  taskId: string;
  sliceId: string;
  attempt: number;
  updatedAt: string;
  lines: GenerationTaskActivityLine[];
}
const activityShape = shape({
  schema: oneOf([GENERATION_TASK_ACTIVITY_SCHEMA]),
  taskId,
  sliceId,
  attempt: count(1_000_000, 1),
  updatedAt: isoInstant,
  lines: arrayOf(shape({ at: isoInstant, text: line(GENERATION_TASK_EVENT_BOUNDS.activityLineChars, 1) }), GENERATION_TASK_EVENT_BOUNDS.activityLines),
});
export function generationTaskActivityIssue(value: unknown): Issue { return activityShape(value, "activity"); }
/** Append one server line (bounded, redacted) and keep the last 8. Pure. */
export function appendGenerationTaskActivity(previous: GenerationTaskActivity | null, input: { taskId: string; sliceId: string; attempt: number; at: string; text: string }): GenerationTaskActivity {
  const kept = previous && previous.sliceId === input.sliceId && previous.attempt === input.attempt ? previous.lines : [];
  const next: GenerationTaskActivity = {
    schema: GENERATION_TASK_ACTIVITY_SCHEMA, taskId: input.taskId, sliceId: input.sliceId, attempt: input.attempt, updatedAt: input.at,
    lines: [...structuredClone(kept), { at: input.at, text: cleanLine(input.text, GENERATION_TASK_EVENT_BOUNDS.activityLineChars) }].slice(-GENERATION_TASK_EVENT_BOUNDS.activityLines),
  };
  const issue = generationTaskActivityIssue(next);
  if (issue) throw new GenerationTaskContractError("GENERATION_TASK_ACTIVITY_INVALID", issue);
  return next;
}
