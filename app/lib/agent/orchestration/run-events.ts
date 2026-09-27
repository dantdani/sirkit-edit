/**
 * [B21 E2] The additive v1 run events of an orchestrated chat run (OD-126, D21-22), built and judged here. The pinned list and the
 * closed shapes live in the agent contracts beside the other run events (the chat protocol's source); this module BUILDS every one
 * bounded - a message at most 1 500 characters and a reason at most 1 000, each through the model-bound redactor with every control,
 * format and line-separator character replaced by a space; a model id at most 100 characters - and JUDGES one
 * (`orchestrationRunEventIssue`: exactly its type's keys, ids by the orchestration id grammar, roles by the closed role list, counts
 * as bounded integers, no credential-shaped value anywhere). The scheduler and the runtime emit them IN PLACE of B21-B's warning
 * lines for the plan, a specialist's status and the degraded and stand-down facts, each carrying B's sentence as its `message`, so
 * the run log reads as before and the coordinator's trace records the same lines (`RUN_EVENT_TRACE_TYPES`); a specialist's refused
 * tool call, a merge line and an approval line stay warnings. Two facts are new: `specialist_started` (one per attempt that reaches
 * the provider layer, with the budget remaining) and `partial_result` (a run whose planned specialists did not all deliver a result
 * the merge could use). [B21 E2 fix] A third: when the scheduler withholds a re-run it promised (`runsAgain`), it closes the promise
 * with one final `specialist_finished` (`notRunAgainEvent`). The protocol version stays 1; an older reducer ignores every one (an
 * unknown `type` changes nothing - and an older page therefore loses the lines they carry, RECORDED as OD-126's owner question).
 * No chain of thought is carried. [B21 E2 fix: security-2; B21 E2 lead] A `reason` is the scheduler's dissent reason with the one
 * model-chosen part withheld: A's refusal names the PATH it refused, which can run through a key the model chose (an undeclared key, a
 * reasoning-shaped key name, a key inside an artifact's payload), so a path not made only of declared names reads `UNDECLARED_KEY_WITHHELD`. `model` is the
 * id the provider reported (provider text, bounded and clean) - display data, never authority.
 */
import { DEGRADED_REASONS, ORCHESTRATION_RUN_EVENT_TYPES, SPECIALIST_FINISHED_STATUSES, type DegradedReason, type OrchestrationRunEvent, type OrchestrationRunEventType, type SpecialistFinishedStatus } from "../contracts";
import { containsTokenAnchoredSecretShapedText, sanitizeModelBoundText } from "../redaction";
import type { LLMProviderId } from "../../llm/types";
import { SPECIALIST_DECLARED_KEYS, SPECIALIST_ROLES, isOrchestrationDigest, isOrchestrationId, type SpecialistRole } from "./contracts";

export const RUN_EVENT_BOUNDS = Object.freeze({
  /** a run-log line: B21-B's longest sentences (a pause message inside a fallback line) fit well inside it */
  maxMessageChars: 1_500,
  /** the scheduler's dissent reason bound */
  maxReasonChars: 1_000,
  /** the trace's own model bound */
  maxModelChars: 100,
  maxRuleChars: 64,
  /** a plan never holds more tasks than the contracts' array bound (the cap is 4; a longer plan is refused before any event) */
  maxTasks: 32,
  /** attempts, counts and task figures */
  maxCount: 1_000,
});
/** Each type's CLOSED key set, in the order the builders write them. */
export const RUN_EVENT_KEYS: Readonly<Record<OrchestrationRunEventType, readonly string[]>> = Object.freeze({
  plan: Object.freeze(["type", "runId", "rule", "tasks", "scheduled", "notRun", "parallelism", "wallTimeMs", "outputTokenCeiling", "message"]),
  specialist_started: Object.freeze(["type", "runId", "taskId", "role", "provider", "model", "attempt", "wallTimeRemainingMs", "outputTokensRemaining", "message"]),
  specialist_finished: Object.freeze(["type", "runId", "taskId", "role", "provider", "model", "attempt", "status", "reason", "resultDigest", "runsAgain", "message"]),
  partial_result: Object.freeze(["type", "runId", "planned", "usable", "unusable", "mergeWithheld", "notStarted", "handedOn", "message"]),
  degraded: Object.freeze(["type", "runId", "reason", "taskId", "role", "provider", "model", "message"]),
});
/** The events whose line the coordinator's trace records, exactly as B21-B recorded the warning each replaces (the first
 *  ORCHESTRATION_TRACE_LINES_MAX lines, and every stand-down line): `specialist_started` and `partial_result` replace no B line and
 *  are stream-only, so the coordinator's trace holds what it held at HEAD ([B21 E2 fix] plus a closing line where a promised re-run
 *  was withheld - a line HEAD never wrote, leaving the promise open). */
export const RUN_EVENT_TRACE_TYPES: readonly OrchestrationRunEventType[] = Object.freeze(["plan", "specialist_finished", "degraded"]);
/** [B21 E2 fix: security-2] What an undeclared key's path reads in a reason and a line: its name is model text, never repeated. */
export const UNDECLARED_KEY_WITHHELD = "[an undeclared key - its name is model text, withheld]";

// ─── Bounded values ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** every control, format and line-separator character (a run-log line is one line: LF and TAB included) */
const LINE_BREAKING = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
/** One run-log line: redacted by the model-bound redactor (a key prefix must start a token: `task-1-...` is not a key), every
 *  control, format and separator character a space, cut to `max`. */
export function boundedRunEventText(text: string, max: number): string {
  return sanitizeModelBoundText(text).replace(LINE_BREAKING, " ").slice(0, max);
}
const model = (value: string | null | undefined): string | null => (typeof value === "string" && value.length > 0 ? boundedRunEventText(value, RUN_EVENT_BOUNDS.maxModelChars) : null);
const count = (value: number): number => (Number.isSafeInteger(value) && value >= 0 ? Math.min(value, RUN_EVENT_BOUNDS.maxCount) : 0);
const figure = (value: number): number => (Number.isFinite(value) ? Math.min(Math.max(0, Math.floor(value)), Number.MAX_SAFE_INTEGER) : 0);
/** [B21 E2 fix: security-2; B21 E2 lead] A's refusal names the PATH it refused, and a path can run through a key the model chose (an
 *  undeclared key, a reasoning-shaped key name A refuses, a key inside an artifact's payload): a path made only of the documents'
 *  DECLARED key names and array indices is server text and kept; any other path - everything after " at " - is withheld whole. */
const RESULT_REFUSAL_AT = /result_refused: [a-z_]+ at /;
const DECLARED_PATH = new RegExp(`^\\$(?:\\.(?:${SPECIALIST_DECLARED_KEYS.join("|")})|\\[\\d+\\])*$`);
function withoutModelKey(text: string): string {
  const match = RESULT_REFUSAL_AT.exec(text);
  if (!match) return text;
  const cut = match.index + match[0].length;
  const stop = text.endsWith(".") ? "." : "";
  return DECLARED_PATH.test(text.slice(cut, text.length - stop.length)) ? text : `${text.slice(0, cut)}${UNDECLARED_KEY_WITHHELD}${stop}`;
}

// ─── The builders (every event the scheduler and the runtime emit is built here) ───────────────────────────────────────────

export interface PlanEventInput { runId: string; rule: string | undefined; tasks: ReadonlyArray<{ taskId: string; role: SpecialistRole }>; scheduled: number; notRun: number; parallelism: number; wallTimeMs: number; outputTokenCeiling: number; message: string }
export function planEvent(input: PlanEventInput): OrchestrationRunEvent {
  return {
    type: "plan", runId: input.runId, rule: input.rule ? boundedRunEventText(input.rule, RUN_EVENT_BOUNDS.maxRuleChars) : null,
    tasks: input.tasks.slice(0, RUN_EVENT_BOUNDS.maxTasks).map((task) => ({ taskId: task.taskId, role: task.role })),
    scheduled: count(input.scheduled), notRun: count(input.notRun), parallelism: count(input.parallelism), wallTimeMs: figure(input.wallTimeMs), outputTokenCeiling: figure(input.outputTokenCeiling),
    message: boundedRunEventText(input.message, RUN_EVENT_BOUNDS.maxMessageChars),
  };
}
/** One attempt of a task reaching the provider layer (its loop is about to call the model): the route's provider and model, and
 *  [B21 E2 fix: coverage-5] the budget remaining - the DAG wall time left and the output-token ceiling not yet used (reported, never
 *  priced or enforced, OD-107). */
export function specialistStartedEvent(input: { runId: string; taskId: string; role: SpecialistRole; provider: LLMProviderId; model: string | null; attempt: number; wallTimeRemainingMs: number; outputTokensRemaining: number }): OrchestrationRunEvent {
  const served = model(input.model);
  const wall = figure(input.wallTimeRemainingMs);
  const tokens = figure(input.outputTokensRemaining);
  return {
    type: "specialist_started", runId: input.runId, taskId: input.taskId, role: input.role, provider: input.provider, model: served, attempt: count(input.attempt), wallTimeRemainingMs: wall, outputTokensRemaining: tokens,
    message: boundedRunEventText(`Orchestration: specialist ${input.role} started (task ${input.taskId}, attempt ${count(input.attempt)}) on ${input.provider}${served ? ` (${served})` : ""}; ${Math.floor(wall / 1_000)} s of the DAG wall time and ${tokens} output tokens of its reported ceiling remain.`, RUN_EVENT_BOUNDS.maxMessageChars),
  };
}
/** The fields of a scheduler task outcome the finished event carries (the scheduler's `SpecialistTaskOutcome` is one). */
export interface FinishedOutcome { taskId: string; role: SpecialistRole; attempt: number; status: "accepted" | "malformed" | "escalated" | "replayed"; reason: string | null; resultDigest: string | null; provider: LLMProviderId; model: string | null }
export type SpecialistFinishedEvent = Extract<OrchestrationRunEvent, { type: "specialist_finished" }>;
/** A task attempt's outcome, as B21-B's status line said it (`message`); `runsAgain` when the scheduler retries the task. */
export function specialistFinishedEvent(runId: string, outcome: FinishedOutcome, message: string, runsAgain = false): SpecialistFinishedEvent {
  return finished(runId, { ...outcome, status: outcome.status }, message, runsAgain);
}
/** A committed result the resume will not replay (another scope or revision, or the merge's stale / expired verdict): the task runs
 *  again. [B21 E2 fix: coverage-2] Its provenance is unrecorded (the record keeps no provider per result): no provider is named. */
export function staleResultEvent(runId: string, input: { taskId: string; role: SpecialistRole; attempt: number; resultDigest: string; reason: string }, message: string): SpecialistFinishedEvent {
  return finished(runId, { taskId: input.taskId, role: input.role, attempt: input.attempt, status: "stale", reason: input.reason, resultDigest: input.resultDigest, provider: null, model: null }, message, true);
}
/** [B21 E2 fix: regressions-1, coverage-6] The promise of a `runsAgain` event CLOSED: the scheduler did not run the task again (the
 *  DAG wall time, the coordinator's paused provider or a record failure stopped it first) - the same attempt's outcome, final. A
 *  retried task's escalated attempt stands (the task finished); a stale committed result stays stale (the task never ran again). */
export function notRunAgainEvent(open: SpecialistFinishedEvent, why: string): SpecialistFinishedEvent {
  const tail = open.status === "stale" ? `its committed result (attempt ${open.attempt}) stays stale and is not handed on` : `attempt ${open.attempt} stands ${open.status}`;
  return { ...open, runsAgain: false, message: boundedRunEventText(`Orchestration: specialist ${open.role} (task ${open.taskId}) was not run again (${why}); ${tail}.`, RUN_EVENT_BOUNDS.maxMessageChars) };
}
function finished(runId: string, outcome: Omit<FinishedOutcome, "status" | "provider"> & { status: SpecialistFinishedStatus; provider: LLMProviderId | null }, message: string, runsAgain: boolean): SpecialistFinishedEvent {
  const unrecorded = outcome.status === "replayed" || outcome.status === "stale"; // [B21 E2 fix: coverage-2] the merge's UNRECORDED_SOURCE
  return {
    type: "specialist_finished", runId, taskId: outcome.taskId, role: outcome.role, provider: unrecorded ? null : outcome.provider, model: unrecorded ? null : model(outcome.model), attempt: count(outcome.attempt),
    status: outcome.status, reason: outcome.reason === null ? null : boundedRunEventText(withoutModelKey(outcome.reason), RUN_EVENT_BOUNDS.maxReasonChars),
    resultDigest: isOrchestrationDigest(outcome.resultDigest) ? outcome.resultDigest : null, runsAgain,
    message: boundedRunEventText(withoutModelKey(message), RUN_EVENT_BOUNDS.maxMessageChars),
  };
}
/** A degradation, run-wide (`task` absent) or of one planned specialist, as B21-B's line said it. */
export function degradedEvent(runId: string, reason: DegradedReason, message: string, task?: { taskId: string; role: SpecialistRole; provider: LLMProviderId | null; model: string | null }): OrchestrationRunEvent {
  return {
    type: "degraded", runId, reason, taskId: task?.taskId ?? null, role: task?.role ?? null, provider: task?.provider ?? null, model: model(task?.model),
    message: boundedRunEventText(message, RUN_EVENT_BOUNDS.maxMessageChars),
  };
}
/** The run's partial result, or null when every planned specialist delivered: per task its LAST attempt decides (accepted or
 *  replayed is usable; malformed or escalated is not) and ([B21 E2 fix: security-1]) once the merge judged the results, a result it
 *  withheld (malformed, stale, expired or contradicted - its `mergeWithheld` task ids) is not usable either; [B21 E2 fix:
 *  regressions-1] a task counts ONCE - one listed not started that also has an outcome (a withheld retry) is counted by its outcome,
 *  and `planned` is the plan's task count. `handedOn`: the follow-up turn ran over what was committed; otherwise the coordinator's
 *  first answer stands. */
export function partialResultEvent(runId: string, input: { planned: number; tasks: ReadonlyArray<{ taskId: string; status: string }>; notStarted: ReadonlyArray<{ taskId: string }>; mergeWithheld?: readonly string[] | null; handedOn: boolean }): OrchestrationRunEvent | null {
  const last = new Map<string, string>();
  for (const task of input.tasks) last.set(task.taskId, task.status);
  const withheldIds = new Set(input.mergeWithheld ?? []);
  const answered = [...last.entries()].filter(([, status]) => status === "accepted" || status === "replayed");
  const withheld = input.mergeWithheld === undefined || input.mergeWithheld === null ? null : answered.filter(([taskId]) => withheldIds.has(taskId)).length;
  const usable = answered.length - (withheld ?? 0);
  const unusable = last.size - answered.length;
  const notStarted = new Set(input.notStarted.map((task) => task.taskId).filter((taskId) => !last.has(taskId))).size;
  const planned = Math.max(count(input.planned), last.size + notStarted);
  if (usable >= planned) return null;
  const tail = input.handedOn ? "the follow-up turn used what was committed, and says what stays missing" : "no follow-up turn used them; the assistant's answer above stands";
  return {
    type: "partial_result", runId, planned: count(planned), usable: count(usable), unusable: count(unusable), mergeWithheld: withheld === null ? null : count(withheld), notStarted: count(notStarted), handedOn: input.handedOn,
    message: boundedRunEventText(`Orchestration: partial result - ${usable} of ${planned} planned specialist(s) delivered a usable result (${unusable} escalated or malformed, ${withheld === null ? "" : `${withheld} withheld by the deterministic merge, `}${notStarted} not started); ${tail}.`, RUN_EVENT_BOUNDS.maxMessageChars),
  };
}

// ─── The judge ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function isOrchestrationRunEvent(event: unknown): event is OrchestrationRunEvent {
  return typeof event === "object" && event !== null && typeof (event as { type?: unknown }).type === "string" && (ORCHESTRATION_RUN_EVENT_TYPES as readonly string[]).includes((event as { type: string }).type);
}
const SPECIALISTS: readonly string[] = SPECIALIST_ROLES.filter((role) => role !== "coordinator");
const RULE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const LINE_FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
function lineIssue(value: unknown, max: number): boolean {
  return typeof value !== "string" || value.length > max || LINE_FORBIDDEN.test(value) || containsTokenAnchoredSecretShapedText(value);
}
const bounded = (value: unknown, max: number = RUN_EVENT_BOUNDS.maxCount): boolean => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
const provider = (value: unknown, nullable: boolean): boolean => value === "openai" || value === "anthropic" || (nullable && value === null);
const modelIssue = (value: unknown): boolean => value !== null && lineIssue(value, RUN_EVENT_BOUNDS.maxModelChars);
const roleOf = (value: unknown): boolean => typeof value === "string" && SPECIALISTS.includes(value);

/** The first rule an event breaks (`<key>: <rule>`), or null when it is one of the five closed shapes, bounded and clean. Never throws. */
export function orchestrationRunEventIssue(event: unknown): string | null {
  try {
    if (typeof event !== "object" || event === null || Array.isArray(event)) return "event: must be an object";
    const record = event as Record<string, unknown>;
    const type = record.type;
    if (typeof type !== "string" || !(ORCHESTRATION_RUN_EVENT_TYPES as readonly string[]).includes(type)) return "type: outside the pinned list";
    const keys = RUN_EVENT_KEYS[type as OrchestrationRunEventType];
    const present = Reflect.ownKeys(record);
    if (present.length !== keys.length || !present.every((key) => typeof key === "string" && keys.includes(key))) return `${type}: exact keys required`;
    if (!isOrchestrationId(record.runId)) return "runId: outside the id grammar";
    if (lineIssue(record.message, RUN_EVENT_BOUNDS.maxMessageChars)) return "message: a bounded, clean line is required";
    switch (type) {
      case "plan": {
        if (record.rule !== null && (typeof record.rule !== "string" || !RULE_PATTERN.test(record.rule))) return "rule: outside its pattern";
        if (!Array.isArray(record.tasks) || record.tasks.length > RUN_EVENT_BOUNDS.maxTasks) return "tasks: a bounded list is required";
        for (const task of record.tasks as unknown[]) {
          if (typeof task !== "object" || task === null || Array.isArray(task)) return "tasks: every entry an object";
          const entry = task as Record<string, unknown>;
          if (Object.keys(entry).length !== 2 || !isOrchestrationId(entry.taskId) || !roleOf(entry.role)) return "tasks: exactly a task id and a specialist role";
        }
        for (const key of ["scheduled", "notRun", "parallelism"] as const) if (!bounded(record[key], RUN_EVENT_BOUNDS.maxTasks)) return `${key}: a bounded count is required`;
        if (!bounded(record.wallTimeMs, Number.MAX_SAFE_INTEGER) || !bounded(record.outputTokenCeiling, Number.MAX_SAFE_INTEGER)) return "figures: nonnegative integers are required";
        return null;
      }
      case "specialist_started":
      case "specialist_finished": {
        if (!isOrchestrationId(record.taskId)) return "taskId: outside the id grammar";
        if (!roleOf(record.role)) return "role: not a specialist role";
        // [B21 E2 fix: coverage-2] an attempt that ran names the provider that served it; a replayed or stale result names none
        const unrecorded = type === "specialist_finished" && (record.status === "replayed" || record.status === "stale");
        if (unrecorded ? record.provider !== null || record.model !== null : !provider(record.provider, false)) return unrecorded ? "provider: null for an unrecorded provenance (replayed, stale)" : "provider: openai or anthropic";
        if (modelIssue(record.model)) return "model: null or a bounded, clean id";
        if (!bounded(record.attempt)) return "attempt: a bounded count is required";
        if (type === "specialist_started") {
          if (!bounded(record.wallTimeRemainingMs, Number.MAX_SAFE_INTEGER) || !bounded(record.outputTokensRemaining, Number.MAX_SAFE_INTEGER)) return "budget remaining: nonnegative integers are required";
          return null;
        }
        if (typeof record.status !== "string" || !(SPECIALIST_FINISHED_STATUSES as readonly string[]).includes(record.status)) return "status: outside the closed vocabulary";
        if (record.reason !== null && lineIssue(record.reason, RUN_EVENT_BOUNDS.maxReasonChars)) return "reason: null or a bounded, clean line";
        if (record.resultDigest !== null && !isOrchestrationDigest(record.resultDigest)) return "resultDigest: null or an orchestration digest";
        if (typeof record.runsAgain !== "boolean") return "runsAgain: a boolean is required";
        return null;
      }
      case "partial_result": {
        for (const key of ["planned", "usable", "unusable", "notStarted"] as const) if (!bounded(record[key], RUN_EVENT_BOUNDS.maxTasks)) return `${key}: a bounded count is required`;
        if (record.mergeWithheld !== null && !bounded(record.mergeWithheld, RUN_EVENT_BOUNDS.maxTasks)) return "mergeWithheld: null or a bounded count";
        if ((record.usable as number) >= (record.planned as number)) return "usable: a partial result has fewer usable results than planned tasks";
        // [B21 E2 fix: regressions-1] each planned task is counted once: the parts never exceed the plan
        if ((record.usable as number) + (record.unusable as number) + ((record.mergeWithheld as number | null) ?? 0) + (record.notStarted as number) > (record.planned as number)) return "counts: the parts exceed the planned tasks";
        if (typeof record.handedOn !== "boolean") return "handedOn: a boolean is required";
        return null;
      }
      default: {
        if (typeof record.reason !== "string" || !(DEGRADED_REASONS as readonly string[]).includes(record.reason)) return "reason: outside the closed vocabulary";
        if (record.taskId !== null && !isOrchestrationId(record.taskId)) return "taskId: null or an id";
        if (record.role !== null && !roleOf(record.role)) return "role: null or a specialist role";
        if (!provider(record.provider, true)) return "provider: null, openai or anthropic";
        if (modelIssue(record.model)) return "model: null or a bounded, clean id";
        if ((record.taskId === null) !== (record.role === null)) return "taskId and role: both or neither";
        return null;
      }
    }
  } catch {
    return "event: could not be judged";
  }
}
