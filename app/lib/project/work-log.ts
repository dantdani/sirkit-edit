/**
 * [K2, 2026-11-04] Runbook K.2 (OD-260 items 5 and 6): the Work log's pure reducers - the ONE fold of the chat run's typed events, a
 * followed acquisition task's stored progress events and a followed design task's milestones into the rows the existing activity entry
 * shows collapsed under "Show details". No independent stream: the inputs are the run events the page already receives
 * (app/lib/agent/contracts.ts `AgentRunEvent`, through the NDJSON route), the acquisition task's public view (GET
 * /api/parts/acquisitions) and the generation task's view (app/lib/project/generation-task-client.ts). Display only; nothing here is sent
 * to a server or grants anything.
 *
 *  - Identity, order and dedup: a log reads ONE run (its `runId`, pinned by `run_started`); an event of another run - a retired turn, a
 *    late chunk - changes nothing. A run event with the route's `seq` at or below the newest one folded is a replay and is dropped; a
 *    task event at or below the follow's cursor is too. Rows carry their own monotonic `seq`.
 *  - Ownership: a task update folds only into the log of the project and branch the log belongs to, and only for a task the log follows.
 *  - Phases (work-log-contract.ts): a tool that started is `dispatched` until its result is `received`; a sealed proposal is `proposed`;
 *    only a server-confirmed settlement is `committed`; a refusal says what did not run.
 *  - Bounds: at most 40 rows; older rows are dropped and counted ("earlier steps not kept"), as is a followed task's history its own ring
 *    no longer holds.
 *  - Never model text: `text_delta` (interim or final) adds no row - the interim-text hold and the answer's own labels stay as they are.
 */
import { CAD_ACQUISITION_TERMINAL_STATES, readCadAcquisitionTaskReference, type CadAcquisitionEventKind, type CadAcquisitionTaskView } from "../acquisition/cad-acquisition-contract";
import { refusedLineLabel, toolLineLabel } from "./chat-run-view";
import { resolutionProgressLine } from "./component-resolution-events";
import { generationTaskAllowanceText, type GenerationTaskEventView, type GenerationTaskView } from "./generation-task-client";
import { WORK_LOG_BOUNDS, WORK_LOG_PHASE_LABELS, readStoredWorkLog, workLogSourceFor, workLogText, type WorkLogFollow, type WorkLogOrigin, type WorkLogPhase, type WorkLogRow, type WorkLogState } from "./work-log-contract";

export * from "./work-log-contract";

type RowInput = { key: string; phase: WorkLogPhase; origin: WorkLogOrigin; text: string; subject?: string | null; attempt?: number | null; next?: string | null; sourceFrom?: string };

function addRows(state: WorkLogState, inputs: readonly RowInput[]): WorkLogState {
  const known = new Set(state.rows.map((row) => row.key));
  let nextSeq = state.nextSeq;
  const added: WorkLogRow[] = [];
  for (const input of inputs) {
    const key = input.key.slice(0, WORK_LOG_BOUNDS.keyChars);
    const text = workLogText(input.text);
    if (!text || known.has(key)) continue;
    known.add(key);
    added.push({ key, seq: nextSeq, phase: input.phase, origin: input.origin, text, subject: input.subject ? workLogText(input.subject, WORK_LOG_BOUNDS.subjectChars) || null : null, attempt: typeof input.attempt === "number" && Number.isInteger(input.attempt) && input.attempt >= 0 ? input.attempt : null, source: input.sourceFrom ? workLogSourceFor(input.sourceFrom) : null, next: input.next ? workLogText(input.next, WORK_LOG_BOUNDS.nextChars) || null : null });
    nextSeq += 1;
  }
  if (added.length === 0) return state;
  const rows = [...state.rows, ...added];
  const over = Math.max(0, rows.length - WORK_LOG_BOUNDS.rows);
  return { ...state, rows: over > 0 ? rows.slice(over) : rows, nextSeq, dropped: state.dropped + over };
}

function follow(state: WorkLogState, entry: WorkLogFollow): WorkLogState {
  if (state.follows.some((known) => known.kind === entry.kind && known.taskId === entry.taskId)) return state;
  return { ...state, follows: [...state.follows, entry].slice(-WORK_LOG_BOUNDS.follows) };
}

const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/** A tool status's phase: what really happened when the call finished (a start is a dispatch, a sealed artifact a proposal). */
const FINISHED_PHASES: Readonly<Record<string, WorkLogPhase>> = Object.freeze({
  succeeded: "received", proposal_sealed: "proposed", layout_candidate_ready: "proposed", stackup_candidate_ready: "proposed",
  execution_grant_issued: "dispatched", execution_preview_issued: "waiting", view_command_dispatched: "dispatched", execution_grant_dropped: "refused",
  task_started: "dispatched", task_attached: "received", control_requested: "waiting", acquisition_task_started: "dispatched", acquisition_task_attached: "received",
});

/** The run event types the log reads; every other type (text_delta above all) changes nothing. */
const FOLDED_RUN_EVENTS: ReadonlySet<string> = new Set(["run_started", "tool_started", "tool_finished", "tool_refused", "acquisition_task_ready", "generation_task_ready", "execution_settled", "plan", "specialist_started", "specialist_finished", "partial_result", "degraded", "run_failed", "run_completed"]);

/**
 * Fold one raw run event (as the page receives it from the stream) into the log. `run_started` pins the run; an event of any other run,
 * a replayed sequence, a model sentence or an unknown type changes nothing.
 */
export function reduceWorkLogRunEvent(state: WorkLogState, event: Record<string, unknown>): WorkLogState {
  const runId = str(event.runId);
  if (!runId || !FOLDED_RUN_EVENTS.has(event.type as string)) return state; // a model sentence (text_delta), a warning or an unknown type: the SAME state (no row, no re-render)
  if (state.owner.runId === null) {
    if (event.type !== "run_started") return state;
    state = { ...state, owner: { ...state.owner, runId } };
  } else if (state.owner.runId !== runId) return state; // a retired or foreign run: never this log
  if (typeof event.seq === "number" && Number.isFinite(event.seq)) {
    if (event.seq <= state.runSeq) return state; // a replayed or out-of-order chunk
    state = { ...state, runSeq: event.seq };
  }
  const callId = str(event.callId) ?? "";
  const key = (suffix: string): string => `run:${runId}:${suffix}`;
  const title = str(event.title) ?? "tool";
  switch (event.type) {
    case "tool_started":
      return addRows(state, [{ key: key(`${callId}:started`), phase: "dispatched", origin: "run", text: resolutionProgressLine(event) ?? `${title} — request sent; no result yet` }]);
    case "tool_finished": {
      const status = str(event.status) ?? "unknown";
      const phase = event.ok === true ? (FINISHED_PHASES[status] ?? "received") : "refused";
      return addRows(state, [{ key: key(`${callId}:finished`), phase, origin: "run", text: toolLineLabel(event) }]);
    }
    case "tool_refused":
      return addRows(state, [{ key: key(`${callId}:refused`), phase: "refused", origin: "run", text: refusedLineLabel(event) }]);
    case "acquisition_task_ready": {
      const reference = readCadAcquisitionTaskReference(event.task);
      if (!reference || reference.scope.projectId !== state.owner.projectId || reference.scope.branchId !== state.owner.branchId) {
        return addRows(state, [{ key: key(`${callId}:acquisition-dropped`), phase: "refused", origin: "page", text: "An acquisition task reference the assistant issued was not followed: it was malformed or names another project. Nothing was changed." }]);
      }
      const parts = reference.refDes.join(", ");
      const followed = follow(state, { kind: "acquisition", taskId: reference.taskId, cursor: 0, terminal: CAD_ACQUISITION_TERMINAL_STATES.includes(reference.state), state: reference.state });
      return addRows(followed, [{ key: key(`${callId}:acquisition`), phase: "waiting", origin: "page", subject: parts || null, text: `Following acquisition task ${reference.taskId.slice(0, 16)}… ${reference.disposition === "attached" ? "(already running; nothing new started)" : "(queued for a worker)"}: its recorded steps appear here as the worker reports them` }]);
    }
    case "generation_task_ready": {
      const task = event.task as Record<string, unknown> | undefined;
      const taskId = str(task?.taskId);
      return taskId ? follow(state, { kind: "generation", taskId, cursor: 0, terminal: false, state: str(task?.state) }) : state;
    }
    case "execution_settled": {
      const status = str(event.status);
      const outcome = str(event.outcome);
      const grantId = str(event.grantId) ?? callId;
      if (status === "settled" && outcome === "committed") return addRows(state, [{ key: key(`${grantId}:settled`), phase: "committed", origin: "run", text: "Applied in your editor — the server recorded the committed transaction" }]);
      if (status === "settled") return addRows(state, [{ key: key(`${grantId}:settled`), phase: "refused", origin: "run", text: `Not applied — the editor reported ${outcome ?? "no outcome"}; nothing was changed` }]);
      if (status === "retired") return addRows(state, [{ key: key(`${grantId}:settled`), phase: "cancelled", origin: "run", text: `Not applied — the change was retired (${str(event.reason) ?? "no reason recorded"}); nothing was changed` }]);
      return addRows(state, [{ key: key(`${grantId}:settled`), phase: "waiting", origin: "run", text: "Outcome not confirmed yet — the editor has not settled the change; the entry below follows it" }]);
    }
    case "plan":
      return addRows(state, [{ key: key("plan"), phase: "intent", origin: "run", text: str(event.message) ?? "Orchestration planned" }]);
    case "specialist_started":
      return addRows(state, [{ key: key(`specialist:${str(event.taskId) ?? ""}:${String(event.attempt ?? "")}:started`), phase: "dispatched", origin: "run", text: str(event.message) ?? "A specialist started", attempt: typeof event.attempt === "number" ? event.attempt : null }]);
    case "specialist_finished":
      return addRows(state, [{ key: key(`specialist:${str(event.taskId) ?? ""}:${String(event.attempt ?? "")}:finished`), phase: event.status === "accepted" || event.status === "replayed" ? "received" : "refused", origin: "run", text: str(event.message) ?? "A specialist finished", attempt: typeof event.attempt === "number" ? event.attempt : null }]);
    case "partial_result":
      return addRows(state, [{ key: key("partial"), phase: "received", origin: "run", text: str(event.message) ?? "Partial result" }]);
    case "degraded":
      return addRows(state, [{ key: key(`degraded:${str(event.reason) ?? ""}:${str(event.taskId) ?? ""}`), phase: "blocked", origin: "run", text: str(event.message) ?? "Degraded" }]);
    case "run_failed": {
      const reason = str(event.reason) ?? "failed";
      if (reason === "stream_cut") return endWorkLogRun(state, "ended"); // the page's own reading of a dropped stream (a disconnect, not a failure the run reported)
      const cancelled = reason === "cancelled" || reason === "stopped";
      const next = { ...state, run: cancelled ? ("cancelled" as const) : ("failed" as const) };
      return addRows(next, [{ key: key("terminal"), phase: cancelled ? "cancelled" : "blocked", origin: "run", text: cancelled ? "Answer stopped — the turn ended; a task it started keeps its own state below" : `The answer ended early (${reason}) — nothing more runs in this turn`, ...(cancelled ? {} : { next: "Send the message again, or ask the assistant to continue" }) }]);
    }
    case "run_completed":
      return { ...state, run: "completed" };
    default:
      return state; // text_delta (never a row), warnings, typed artifacts (their tool line says it), unknown types
  }
}

/** An acquisition event kind's phase (K.2: each names a real step the worker or a person took). */
const ACQUISITION_PHASES: Readonly<Record<CadAcquisitionEventKind, WorkLogPhase>> = Object.freeze({
  accepted: "dispatched", worker_claimed: "dispatched", local_search: "dispatched", local_candidate_found: "received", source_selected: "dispatched", source_skipped: "skipped",
  retrieved: "received", stored: "stored", validated: "validated", validation_failed: "blocked", awaiting_handoff: "waiting", handed_off: "dispatched", awaiting_publication: "waiting",
  publication_checked: "received", published: "stored", proposal_ready: "proposed", applied: "committed", preflight: "validated", waiting_resource: "waiting", blocked: "blocked", cancelled: "cancelled", failed: "blocked",
});
const NEXT_ACTION_TEXT: Readonly<Record<CadAcquisitionTaskView["nextAction"], string | null>> = Object.freeze({
  wait: null, none: null,
  "send-for-review": "Send the package for component review from the Missing parts list (a person's step; two other people publish it)",
  "await-publication": "Waiting for two people to review and publish the revision; then use Check again",
  "offer-replacement": "Offer the replacement from the Missing parts list, then review and approve it",
});

/**
 * Fold a followed acquisition task's public view (as GET /api/parts/acquisitions answered it) into the log: only for a task this log
 * follows, in this log's project and branch; each stored event once, in its own order; a history the task's ring no longer holds is
 * counted as not kept. The blocker's remedy and the next action are the server's own sentences.
 */
export function reduceWorkLogAcquisition(state: WorkLogState, task: CadAcquisitionTaskView, scope: { projectId: string; branchId: string }): WorkLogState {
  if (scope.projectId !== state.owner.projectId || scope.branchId !== state.owner.branchId) return state; // another project's or branch's answer
  const index = state.follows.findIndex((entry) => entry.kind === "acquisition" && entry.taskId === task.taskId);
  if (index < 0 || !Array.isArray(task.events)) return state; // not a task this log follows
  const current = state.follows[index]!;
  const fresh = task.events.filter((event) => typeof event?.seq === "number" && event.seq > current.cursor).sort((a, b) => a.seq - b.seq);
  const terminal = CAD_ACQUISITION_TERMINAL_STATES.includes(task.state);
  const cursor = fresh.length > 0 ? fresh[fresh.length - 1]!.seq : current.cursor;
  const missing = fresh.length > 0 ? Math.max(0, fresh[0]!.seq - current.cursor - 1) : 0;
  if (fresh.length === 0 && current.terminal === terminal && current.state === task.state) return state; // nothing new: the SAME state (a poll that saw no step re-renders nothing)
  const follows = state.follows.map((entry, at) => (at === index ? { ...entry, cursor, terminal, state: task.state } : entry));
  let next: WorkLogState = { ...state, follows, ...(missing > 0 ? { gap: true, dropped: state.dropped + missing } : {}) };
  const subject = task.targets.map((target) => target.refDes).filter(Boolean).join(", ") || null;
  const last = fresh[fresh.length - 1];
  next = addRows(next, fresh.map((event) => {
    const phase = ACQUISITION_PHASES[event.kind] ?? "received";
    const attempt = event.data && typeof event.data.attempt === "number" ? event.data.attempt : null;
    const nextStep = event === last ? (task.blocker ? `${task.blocker.remedy}` : NEXT_ACTION_TEXT[task.nextAction]) : null;
    return { key: `acquisition:${task.taskId}:${event.seq}`, phase, origin: "acquisition" as const, text: event.message, subject, attempt, next: phase === "blocked" || phase === "waiting" ? nextStep : null, sourceFrom: event.message };
  }));
  return next;
}

/** A design milestone's phase. */
const GENERATION_PHASES: Readonly<Record<string, WorkLogPhase>> = Object.freeze({
  task_accepted: "dispatched", worker_claimed: "dispatched", plan_ready: "stored", block_started: "dispatched", block_saved: "stored", slice_yielded: "waiting",
  waiting_provider: "waiting", waiting_resource: "blocked", strategy_changed: "intent", merge_started: "dispatched", validation_result: "validated", result_ready: "proposed",
  paused: "waiting", resumed: "dispatched", cancel_requested: "waiting", cancelled: "cancelled", stale: "blocked", failed: "blocked",
});

/**
 * Fold a followed design task's new milestones (in order, each once) and its remaining allowance into the log. The view is the client's
 * reduced view (`reduceGenerationTaskView`); `gap`: the cursor read was older than the server's ring.
 */
export function reduceWorkLogGeneration(state: WorkLogState, view: Pick<GenerationTaskView, "taskId" | "scope" | "state" | "terminal" | "allowance" | "blocker">, added: readonly GenerationTaskEventView[], gap: boolean): WorkLogState {
  if (view.scope.projectId !== state.owner.projectId || view.scope.branchId !== state.owner.branchId) return state;
  let next = follow(state, { kind: "generation", taskId: view.taskId, cursor: 0, terminal: view.terminal, state: view.state });
  const index = next.follows.findIndex((entry) => entry.kind === "generation" && entry.taskId === view.taskId);
  const current = next.follows[index]!;
  const fresh = [...added].filter((event) => event.seq > current.cursor).sort((a, b) => a.seq - b.seq);
  const cursor = fresh.length > 0 ? fresh[fresh.length - 1]!.seq : current.cursor;
  const allowance = generationTaskAllowanceText(view) ?? next.allowance;
  if (next === state && fresh.length === 0 && current.terminal === view.terminal && current.state === view.state && allowance === state.allowance && (!gap || state.gap)) return state; // nothing new: the SAME state
  next = { ...next, follows: next.follows.map((entry, at) => (at === index ? { ...entry, cursor, terminal: view.terminal, state: view.state } : entry)), allowance, ...(gap ? { gap: true } : {}) };
  return addRows(next, fresh.map((event) => {
    const phase = event.type === "review_recorded" ? (/\bapplied\b/i.test(event.message) ? "committed" : "discarded") : (GENERATION_PHASES[event.type] ?? "received");
    return { key: `generation:${view.taskId}:${event.seq}`, phase, origin: "generation" as const, text: event.message, subject: event.blockId ? `block ${event.blockId}` : null, next: phase === "blocked" && view.blocker ? view.blocker.resolution : null };
  }));
}

/**
 * The log after a reload: its stored rows are recovered as they were (nothing is replayed); a turn that was still streaming says it was
 * interrupted; followed tasks stay followed (the page re-reads their public views, never re-runs them).
 */
export function restoredWorkLog(state: WorkLogState): WorkLogState {
  if (state.run !== "running" || state.owner.runId === null) return state; // a task-only log (a Build start's design task) had no turn to cut: its task keeps its own state
  return addRows({ ...state, run: "interrupted" }, [{ key: `page:${state.owner.runId}:reload`, phase: "interrupted", origin: "page", text: "The page reloaded while this turn was running — the steps above are what was recorded; nothing was run again" }]);
}

/**
 * The turn ended on this page without the run's own terminal event (K.2: cancellation and disconnect have explicit truthful states):
 * `stopped` - the person pressed Stop answer; `ended` - the stream closed or the request failed before the run said how it ended (a
 * dropped connection). A log that already has its run's ending, or never saw its run start, is unchanged; a task the turn started keeps
 * its own state and stays followed.
 */
export function endWorkLogRun(state: WorkLogState, ending: "stopped" | "ended"): WorkLogState {
  if (state.run !== "running" || state.owner.runId === null) return state;
  const key = `run:${state.owner.runId}:terminal`;
  if (ending === "stopped") return addRows({ ...state, run: "cancelled" }, [{ key, phase: "cancelled", origin: "page", text: "Answer stopped by you — the turn ended before the assistant finished; a task it started keeps its own state below" }]);
  return addRows({ ...state, run: "interrupted" }, [{ key, phase: "interrupted", origin: "page", text: "The answer ended without its final event (the connection dropped or the request failed) — the steps above are what was recorded; nothing more runs in this turn", next: "Send the message again, or ask the assistant to continue" }]);
}

/** A stored entry's `work` as the page restores it: `{ work }` when it reads back (then marked as after a reload), `{}` otherwise. */
export function workOfStored(value: unknown): { work?: WorkLogState } {
  if (value === undefined) return {};
  const read = readStoredWorkLog(value);
  return read ? { work: restoredWorkLog(read) } : {};
}

/** A followed task the page still has to read (not terminal), for the re-follow after a reload. */
export function liveWorkLogFollows(state: WorkLogState, kind: WorkLogFollow["kind"]): WorkLogFollow[] {
  return state.follows.filter((entry) => entry.kind === kind && !entry.terminal);
}

const ORIGIN_LABELS: Readonly<Record<WorkLogOrigin, string>> = Object.freeze({ run: "this answer", acquisition: "acquisition task", generation: "design task", page: "this page" });
/** The collapsed header's one line: how many steps and the latest one's phase and origin - never a row's text again (the entry's own
 *  rows already say it; the details hold the rest). */
export function workLogSummary(state: WorkLogState): string {
  const latest = state.rows[state.rows.length - 1];
  const steps = state.rows.length + state.dropped;
  return latest ? `${steps} step${steps === 1 ? "" : "s"} · latest: ${WORK_LOG_PHASE_LABELS[latest.phase]} (${ORIGIN_LABELS[latest.origin]})` : "no steps recorded yet";
}

