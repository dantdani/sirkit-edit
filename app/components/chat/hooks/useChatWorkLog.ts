/**
 * [K2, 2026-11-04] Runbook K.2 (OD-260 items 6 and 8): the page's Work log glue - the logic lives here, not in app/page.tsx (which keeps
 * its line count and only calls these functions in place).
 *
 *  - `foldRunEvent`: every chat run event the page already applies is folded into its activity entry's Work log (the pure reducer,
 *    app/lib/project/work-log.ts); an `acquisition_task_ready` the log accepted starts following that task.
 *  - `foldGeneration`: a followed design task's new milestones and remaining allowance join its activity entry's Work log.
 *  - `endRun`: a turn that ended on this page without its run's terminal event says how (Stop answer, or a dropped stream).
 *  - Following an acquisition task: its public view is READ through the page's own authorized route (GET /api/parts/acquisitions,
 *    readCadAcquisition) every 1.5 s while a worker can still move it, on a project-generation-owned timer (a project switch cancels it;
 *    a late answer for a retired scope writes nothing), at most 400 reads per follow. Reading is all it does: nothing is started,
 *    retried, sent for review or applied from here.
 *  - After a reload the stored log comes back with the messages; a followed task that was still live is read again (never re-run).
 *
 * No `crypto.randomUUID` draw anywhere: row ids come from event identities (the fixture replay is keyed by the browser's uuid draws).
 */
import { useCallback, useEffect, useRef } from "react";
import type { ProjectAsyncScope } from "@/app/lib/engineering/project-async-scope";
import { readCadAcquisitionTaskReference } from "@/app/lib/acquisition/cad-acquisition-contract";
import { readCadAcquisition } from "@/app/lib/project/cad-acquisition-client";
import type { GenerationTaskEventView, GenerationTaskView } from "@/app/lib/project/generation-task-client";
import { emptyWorkLog, endWorkLogRun, liveWorkLogFollows, reduceWorkLogAcquisition, reduceWorkLogGeneration, reduceWorkLogRunEvent, type WorkLogState } from "@/app/lib/project/work-log";

export const WORK_LOG_POLL_MS = 1_500;
export const WORK_LOG_MAX_READS = 400;
/** The acquisition states a worker can still move by itself (a task waiting for a person or a resource changes only when someone acts). */
const MOVING: ReadonlySet<string> = new Set(["queued", "running", "cancel-requested"]);

type LogMessage = { id: string; role: string; work?: WorkLogState };
type SetMessages<M> = (update: (previous: M[]) => M[]) => void;

export interface ChatWorkLog {
  foldRunEvent(logId: string, scope: ProjectAsyncScope, event: Record<string, unknown>): void;
  foldGeneration(logId: string, scope: ProjectAsyncScope, view: GenerationTaskView, added: readonly GenerationTaskEventView[], gap: boolean): void;
  /** the turn ended on this page without the run's own terminal event: Stop answer (`stopped`) or a dropped stream / failed request (`ended`) */
  endRun(logId: string, scope: ProjectAsyncScope, ending: "stopped" | "ended"): void;
}

const ownerOf = (scope: Pick<ProjectAsyncScope, "projectId" | "branchId">): { projectId: string; branchId: string } => ({ projectId: scope.projectId ?? "local", branchId: scope.branchId });

export function useChatWorkLog<M extends LogMessage>(deps: { messages: readonly M[]; setMessages: SetMessages<M>; captureScope: () => ProjectAsyncScope | null }): ChatWorkLog {
  const { setMessages } = deps;
  const followed = useRef(new Set<string>());
  /** follows this page already ended (the task stopped moving, or the read bound): never restarted by a re-render, only by a reload */
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
    followed.current.add(key);
    const owner = ownerOf(scope);
    let reads = 0;
    const stop = (done = false): void => { followed.current.delete(key); if (done) settled.current.add(key); };
    const tick = async (): Promise<void> => {
      if (!scope.isCurrent()) { stop(); return; }
      reads += 1;
      const answer = await readCadAcquisition({ tenantId: "local", ...owner }, taskId);
      if (!scope.isCurrent()) { stop(); return; } // a late answer for a retired project generation writes nothing
      if (answer.ok && answer.task.taskId === taskId) {
        update(logId, owner, (work) => reduceWorkLogAcquisition(work, answer.task, owner));
        if (!MOVING.has(answer.task.state)) { stop(true); return; }
      }
      if (reads >= WORK_LOG_MAX_READS) { stop(true); return; }
      scope.setTimeout(() => { void tick(); }, WORK_LOG_POLL_MS);
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

  return { foldRunEvent, foldGeneration, endRun };
}
