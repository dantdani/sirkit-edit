"use client";
/**
 * [K2, 2026-11-04] Runbook K.2 (OD-260 item 6): the Work log on the EXISTING activity entry, collapsed under "Show details" (the
 * default UI stays quiet: one summary line). Expanded, it lists the recorded steps with their phase (started / received / validated /
 * saved / for your review / applied / waiting / blocked / ...), the part or task they concern, the attempt the server numbered, a CAD
 * source's registry documentation link and the next action when something waits or is blocked; "earlier steps not kept" when the log
 * or a task's own history dropped older steps; and a followed design task's remaining allowance in task units.
 *
 * Display only: the one control is the view toggle. Rows come from the run's and the tasks' own events (app/lib/project/work-log.ts);
 * none is model text or private reasoning.
 */
import { useState } from "react";
import { WORK_LOG_PHASE_LABELS, workLogSummary, type WorkLogPhase, type WorkLogState } from "@/app/lib/project/work-log";

const PHASE_TONE: Readonly<Record<WorkLogPhase, string>> = Object.freeze({
  intent: "border-zinc-700 text-zinc-300", dispatched: "border-sky-800 text-sky-300", received: "border-zinc-600 text-zinc-200", validated: "border-teal-800 text-teal-300",
  stored: "border-teal-800 text-teal-300", proposed: "border-amber-800 text-amber-300", committed: "border-emerald-800 text-emerald-300", waiting: "border-amber-800 text-amber-300",
  blocked: "border-red-900 text-red-300", skipped: "border-zinc-700 text-zinc-400", refused: "border-red-900 text-red-300", discarded: "border-zinc-700 text-zinc-400",
  cancelled: "border-zinc-700 text-zinc-400", interrupted: "border-zinc-700 text-zinc-400",
});

export function WorkLog({ work, entryId }: { work: WorkLogState; entryId: string }) {
  const [expanded, setExpanded] = useState(false);
  if (work.rows.length === 0 && !work.allowance) return null;
  const detailsId = `${entryId}-work-log`;
  const notKept = work.dropped > 0 || work.gap;
  return (
    <div data-testid="work-log" data-run={work.run} data-rows={work.rows.length} data-expanded={expanded ? "true" : "false"} className="mt-2 border-t border-zinc-800/80 pt-1.5">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="shrink-0 font-medium text-zinc-300">Work log</span>
        <span data-testid="work-log-summary" className="min-w-0 truncate text-zinc-500">{workLogSummary(work)}</span>
        <button type="button" data-testid="work-log-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((open) => !open)} className="ml-auto shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-200 hover:border-zinc-500">{expanded ? "Hide details" : "Show details"}</button>
      </div>
      {expanded ? (
        <div id={detailsId} data-testid="work-log-details" className="mt-1.5 space-y-1">
          {notKept ? <p data-testid="work-log-gap" className="text-[11px] text-zinc-500">Earlier steps not kept{work.dropped > 0 ? ` (${work.dropped})` : ""}.</p> : null}
          <ol className="space-y-1">
            {work.rows.map((row) => (
              <li key={row.key} data-testid="work-log-row" data-phase={row.phase} data-origin={row.origin} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] leading-relaxed">
                <span className={`shrink-0 rounded border px-1 text-[10px] uppercase tracking-wide ${PHASE_TONE[row.phase]}`}>{WORK_LOG_PHASE_LABELS[row.phase]}</span>
                <span className="text-zinc-400">{row.text}</span>
                {row.subject ? <span className="text-zinc-500">· {row.subject}</span> : null}
                {row.attempt !== null ? <span className="text-zinc-500">· attempt {row.attempt}</span> : null}
                {row.source ? <a data-testid="work-log-source" href={row.source.href} target="_blank" rel="noopener noreferrer nofollow" className="text-teal-400 underline-offset-2 hover:underline">{row.source.label}</a> : null}
                {row.next ? <span data-testid="work-log-next" className="basis-full pl-1 text-zinc-300">Next: {row.next}</span> : null}
              </li>
            ))}
          </ol>
          {work.allowance ? <p data-testid="work-log-allowance" className="text-[11px] text-zinc-400">{work.allowance}</p> : null}
          <p className="text-[10px] text-zinc-600">Recorded steps from the run&apos;s and the tasks&apos; own events - not the assistant&apos;s private reasoning.</p>
        </div>
      ) : null}
    </div>
  );
}
