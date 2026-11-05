/**
 * [K2, 2026-11-04] Runbook K.2 (OD-260 items 6 and 8): the page's Work log glue - the logic lives here, not in app/page.tsx (which keeps
 * its line count and only calls these functions in place).
 *
 *  - `foldRunEvent`: every chat run event the page already applies is folded into its activity entry's Work log (the pure reducer,
 *    app/lib/project/work-log.ts); an `acquisition_task_ready` the log accepted starts following that task.
 *  - `foldGeneration`: a followed design task's new milestones and remaining allowance join its activity entry's Work log.
 *  - `foldGenerationReview`: [K2 review, 2026-11-04] events-K2-EV-3: the page stops following a design task once it offers the result;
 *    the review it then records on the task (applied, discarded) and a moved base it reports are READ once, so their milestones
 *    (review_recorded, stale) join the entry's Work log too.
 *  - `endRun`: a turn that ended on this page without its run's terminal event says how (Stop answer, or a dropped stream).
 *  - Following an acquisition task: its public view is READ through the page's own authorized route (GET /api/parts/acquisitions,
 *    readCadAcquisition) until the task reaches a terminal state - every 1.5 s while a worker is moving it, every 6 s while it waits
 *    (for a person, a review re-check or a source's retry time: [K2 review, 2026-11-04] events-K2-EV-1, the worker and people still move
 *    such a task without this page) - on a project-generation-owned timer (a project switch cancels it and ends the follow; a late answer
 *    for a retired scope writes nothing), at most 400 reads per follow. A failed read, a task the server no longer has and the read bound
 *    are said in the log (events-K2-EV-2). Reading is all it does: nothing is started, retried, sent for review or applied from here.
 *  - After a reload, or when the project is opened again, the stored log comes back with the messages; a followed task that was still
 *    live is read again (never re-run).
 *
 * No `crypto.randomUUID` draw anywhere: row ids come from event identities (the fixture replay is keyed by the browser's uuid draws).
 */
import { useCallback, useEffect, useRef } from "react";
import type { ProjectAsyncScope } from "@/app/lib/engineering/project-async-scope";
import { CAD_ACQUISITION_TERMINAL_STATES, readCadAcquisitionTaskReference } from "@/app/lib/acquisition/cad-acquisition-contract";
import { readCadAcquisition } from "@/app/lib/project/cad-acquisition-client";
import { fetchGenerationTaskEvents, reduceGenerationTaskView, type GenerationTaskEventView, type GenerationTaskView } from "@/app/lib/project/generation-task-client";
import { emptyWorkLog, endWorkLogRun, liveWorkLogFollows, noteWorkLogFollow, reduceWorkLogAcquisition, reduceWorkLogGeneration, reduceWorkLogRunEvent, type WorkLogState } from "@/app/lib/project/work-log";

export const WORK_LOG_POLL_MS = 1_500;
/** [K2 review, 2026-11-04] events-K2-EV-1: the cadence for a live task that is waiting (not dropped: only a terminal state ends a follow). */
export const WORK_LOG_WAITING_POLL_MS = 6_000;
export const WORK_LOG_MAX_READS = 400;
/** The acquisition states a worker is moving right now (read every 1.5 s); every other live state waits (read every 6 s). */
const MOVING: ReadonlySet<string> = new Set(["queued", "running", "cancel-requested"]);

type LogMessage = { id: string; role: string; work?: WorkLogState };
type SetMessages<M> = (update: (previous: M[]) => M[]) => void;

export interface ChatWorkLog {
  foldRunEvent(logId: string, scope: ProjectAsyncScope, event: Record<string, unknown>): void;
  foldGeneration(logId: string, scope: ProjectAsyncScope, view: GenerationTaskView, added: readonly GenerationTaskEventView[], gap: boolean): void;
  /** the design task's review (or a moved base) was recorded after the page stopped following it: its new milestones are read once */
  foldGenerationReview(logId: string, scope: ProjectAsyncScope, view: GenerationTaskView): void;
  /** the turn ended on this page without the run's own terminal event: Stop answer (`stopped`) or a dropped stream / failed request (`ended`) */
  endRun(logId: string, scope: ProjectAsyncScope, ending: "stopped" | "ended"): void;
}

const ownerOf = (scope: Pick<ProjectAsyncScope, "projectId" | "branchId">): { projectId: string; branchId: string } => ({ projectId: scope.projectId ?? "local", branchId: scope.branchId });

export function useChatWorkLog<M extends LogMessage>(deps: { messages: readonly M[]; setMessages: SetMessages<M>; captureScope: () => ProjectAsyncScope | null }): ChatWorkLog {
  const { setMessages } = deps;
  /** the follows running now, each with its own token (a follow of an older project generation never removes a newer one) */
  const followed = useRef(new Map<string, symbol>());
  /** follows this page ended in the current project generation (a terminal task, a task the server no longer has, the read bound):
   *  never restarted by a re-render - a reload, or the project opened again, reads them again */
  const settled = useRef(new Set<string>());
  const captureRef = useRef(deps.captureScope);
  useEffect(() => { captureRef.current = deps.captureScope; });

  const update = useCallback((logId: string, owner: { projectId: string; branchId: string }, fold: (work: WorkLogState) => WorkLogState): void => {
    setMessages((previous) => {
      let changed = false;
      const next = previous.map((message) => {
        if (message.role !== "log" || message.id !== logId) return message;
        const work = message.work ?? emptyWorkLog(owner);
        if (work.owner.projectId !== owner.projectId || work.owner.branchId !== owner.branchId) return message; // another project's entry
        const folded = fold(work);
        if (folded === work) return message; // nothing to record (a model sentence, a duplicate, a foreign event): no new entry, no re-render
        changed = true;
        return { ...message, work: folded };
      });
      return changed ? next : previous;
    });
  }, [setMessages]);

  const followAcquisition = useCallback((logId: string, taskId: string, scope: ProjectAsyncScope): void => {
    const key = `${logId}:${taskId}`;
    if (followed.current.has(key) || !scope.isCurrent()) return;
    const token = Symbol(key);
    followed.current.set(key, token);
    const owner = ownerOf(scope);
    let reads = 0;
    const stop = (done = false): void => { if (followed.current.get(key) === token) followed.current.delete(key); if (done) settled.current.add(key); };
    // [K2 review, 2026-11-04] tests-K2-R1: a project switch cancels this follow's timer, so its next read never runs - the follow ends with
    // its project generation (and so does a settled one), and the project opened again reads the task again
    scope.signal.addEventListener("abort", () => { stop(); settled.current.delete(key); }, { once: true });
    const tick = async (): Promise<void> => {
      if (!scope.isCurrent() || followed.current.get(key) !== token) { stop(); return; }
      reads += 1;
      const answer = await readCadAcquisition({ tenantId: "local", ...owner }, taskId);
      if (!scope.isCurrent()) { stop(); return; } // a late answer for a retired project generation writes nothing
      let moving = false;
      if (answer.ok && answer.task.taskId === taskId) {
        const task = answer.task;
        update(logId, owner, (work) => reduceWorkLogAcquisition(work, task, owner));
        if (CAD_ACQUISITION_TERMINAL_STATES.includes(task.state)) { stop(true); return; } // events-K2-EV-1: only a terminal state ends a follow
        moving = MOVING.has(task.state);
      } else if (!answer.ok && answer.status === 404) {
        update(logId, owner, (work) => noteWorkLogFollow(work, owner, taskId, { kind: "gone", code: answer.code })); // events-K2-EV-2
        stop(true);
        return;
      } else {
        update(logId, owner, (work) => noteWorkLogFollow(work, owner, taskId, { kind: "unreadable", code: answer.ok ? "ANSWER_MISMATCH" : answer.code })); // events-K2-EV-2: said once per position; read again at the slower cadence
      }
      if (reads >= WORK_LOG_MAX_READS) { update(logId, owner, (work) => noteWorkLogFollow(work, owner, taskId, { kind: "bound", reads })); stop(true); return; }
      scope.setTimeout(() => { void tick(); }, moving ? WORK_LOG_POLL_MS : WORK_LOG_WAITING_POLL_MS);
    };
    void tick();
  }, [update]);

  const foldRunEvent = useCallback((logId: string, scope: ProjectAsyncScope, event: Record<string, unknown>): void => {
    if (!scope.isCurrent()) return;
    const owner = ownerOf(scope);
    update(logId, owner, (work) => reduceWorkLogRunEvent(work, event));
    if (event.type !== "acquisition_task_ready") return;
    const reference = readCadAcquisitionTaskReference(event.task);
    if (reference && reference.scope.projectId === owner.projectId && reference.scope.branchId === owner.branchId) followAcquisition(logId, reference.taskId, scope);
  }, [update, followAcquisition]);

  const foldGeneration = useCallback((logId: string, scope: ProjectAsyncScope, view: GenerationTaskView, added: readonly GenerationTaskEventView[], gap: boolean): void => {
    if (!scope.isCurrent()) return;
    update(logId, ownerOf(scope), (work) => reduceWorkLogGeneration(work, view, added, gap));
  }, [update]);

  const foldGenerationReview = useCallback((logId: string, scope: ProjectAsyncScope, view: GenerationTaskView): void => {
    if (!scope.isCurrent()) return;
    const owner = ownerOf(scope);
    const after = view.milestones.reduce((cursor, event) => Math.max(cursor, event.seq), 0);
    void fetchGenerationTaskEvents({ projectId: scope.projectId, branchId: scope.branchId }, view.taskId, after, { signal: scope.signal }).then((page) => {
      if (!scope.isCurrent()) return; // a late answer for a retired project generation writes nothing
      if (!page.ok || page.task.taskId !== view.taskId) { update(logId, owner, (work) => reduceWorkLogGeneration(work, view, [], false)); return; } // unreadable now: the view the page holds (its state), no row invented
      const read = reduceGenerationTaskView(view, { task: page.task, events: page.events, gap: page.gap });
      update(logId, owner, (work) => reduceWorkLogGeneration(work, read.view, read.added, page.gap));
    });
  }, [update]);

  // a reload (or a project opened again) brings its stored logs back with the messages: a followed acquisition task that was still live
  // is READ again, in the current project only (the stored cursor keeps every recorded step once)
  useEffect(() => {
    const live = deps.messages.flatMap((message) => (message.role === "log" && message.work ? liveWorkLogFollows(message.work, "acquisition").map((entry) => ({ logId: message.id, taskId: entry.taskId, owner: message.work!.owner })) : []));
    if (live.length === 0) return;
    const scope = captureRef.current();
    if (!scope) return;
    const owner = ownerOf(scope);
    for (const entry of live) if (entry.owner.projectId === owner.projectId && entry.owner.branchId === owner.branchId && !settled.current.has(`${entry.logId}:${entry.taskId}`)) followAcquisition(entry.logId, entry.taskId, scope);
  }, [deps.messages, followAcquisition]);

  const endRun = useCallback((logId: string, scope: ProjectAsyncScope, ending: "stopped" | "ended"): void => {
    if (!scope.isCurrent()) return; // a project switch: that entry belongs to a retired generation
    update(logId, ownerOf(scope), (work) => endWorkLogRun(work, ending));
  }, [update]);

  return { foldRunEvent, foldGeneration, foldGenerationReview, endRun };
}
