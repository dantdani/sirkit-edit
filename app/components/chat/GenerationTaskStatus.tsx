"use client";

/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4: the live status of the project's DURABLE design task inside its activity-log entry in the
 * conversation - what the store says, not a scripted narration: the state sentence (never "running" unless a worker holds the task's
 * live lease; "waiting for a worker" otherwise), the elapsed time on the server's clock with the model-call and catalog-search counts (no
 * percentage: a design has no known end), the blocks and their status, the current worker's latest public activity line, and ONLY the
 * actions the server lists as valid now (Stop design, Pause, Resume, Retry a blocked block, Continue with another allowance, Review the
 * saved blocks) - plus "Start again", a NEW design from the same request, once this task can do nothing more. Every button is labelled by
 * its text; the page owns what each one does (the control route, judged by the store).
 */
import { Button } from "@/components/ui/button";
import {
  GENERATION_TASK_ACTION_LABELS, generationTaskCountsText, generationTaskRestartable, generationTaskStatusText,
  type GenerationTaskClientAction, type GenerationTaskView,
} from "@/app/lib/project/generation-task-client";

export interface GenerationTaskStatusProps {
  view: GenerationTaskView;
  /** an action the server listed (the page sends it to the task's control route) */
  onAction: (action: GenerationTaskClientAction, blockId?: string) => void;
  /** a NEW design from the same request (offered only once this task can do nothing more) */
  onStartAgain: () => void;
  /** a control request is in flight (buttons wait for its answer) */
  busy?: boolean;
}

const BUTTON_ACTIONS = ["cancel", "pause", "resume", "extend-allowance", "review-partial"] as const;
const BLOCK_STATUS_TEXT: Readonly<Record<string, string>> = Object.freeze({ queued: "queued", designing: "designing", saved: "saved", blocked: "blocked", "needs-revalidation": "needs revalidation", omitted: "omitted" });

export function GenerationTaskStatus({ view, onAction, onStartAgain, busy = false }: GenerationTaskStatusProps) {
  const blocks = view.plan?.blocks ?? [];
  const latest = view.activity.at(-1)?.text ?? null;
  const actions = BUTTON_ACTIONS.filter((action) => view.actions.includes(action));
  const retryable = view.actions.includes("retry-block") ? blocks.filter((block) => view.retryBlocks.includes(block.blockId)) : [];
  return (
    <div className="mt-2 space-y-1.5 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1.5" data-testid="generation-task-status" data-task-id={view.taskId} data-state={view.state} data-liveness={view.liveness.state}>
      <p className="text-[11px] leading-relaxed text-zinc-200" data-testid="generation-task-state">{generationTaskStatusText(view)}</p>
      <p className="text-[10px] text-zinc-500" data-testid="generation-task-counts">{generationTaskCountsText(view)}</p>
      {blocks.length > 0 ? (
        <ul className="flex flex-wrap gap-1" aria-label="Design blocks" data-testid="generation-task-blocks">
          {blocks.map((block) => (
            <li key={block.blockId} className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300" data-testid={`generation-task-block-${block.blockId}`} data-status={block.status}>
              {block.name}: {BLOCK_STATUS_TEXT[block.status] ?? block.status}
            </li>
          ))}
        </ul>
      ) : null}
      {latest && !view.terminal ? <p className="truncate text-[10px] text-zinc-500" data-testid="generation-task-activity" title={latest}>Latest: {latest}</p> : null}
      {actions.length > 0 || retryable.length > 0 || generationTaskRestartable(view) ? (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="generation-task-actions">
          {actions.map((action) => (
            <Button key={action} size="sm" variant={action === "cancel" ? "destructive" : "outline"} data-testid={`generation-task-${action}`} disabled={busy} onClick={() => onAction(action)}>
              {GENERATION_TASK_ACTION_LABELS[action]}
            </Button>
          ))}
          {retryable.map((block) => (
            <Button key={block.blockId} size="sm" variant="outline" data-testid={`generation-task-retry-${block.blockId}`} disabled={busy} onClick={() => onAction("retry-block", block.blockId)}>
              Retry block {block.name}
            </Button>
          ))}
          {generationTaskRestartable(view) ? (
            <Button size="sm" variant="outline" data-testid="generation-task-start-again" disabled={busy} onClick={() => onStartAgain()}>
              Start again
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
