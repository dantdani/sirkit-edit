"use client";

/**
 * [PR-C] The workflow strip: the ten journey stages as compact chips and the ONE next action (§E "the primary task line").
 * Presentational only - it renders a `JourneyView` (app/lib/workflow/journey.ts) and reports the clicked action id; the page
 * owns every handler and every authority. The status is always TEXT (a visible word, or a glyph with a visually-hidden word),
 * never colour alone; the current stage is emphasised; a disabled action carries its reason in `title` and as visible text
 * beside the button, because a disabled control must explain its prerequisite accessibly. Neutral zinc, 11-12 px, no
 * gradients, blur or animation.
 */

import type { JourneyActionId, JourneyStageStatus, JourneyView } from "@/app/lib/workflow/journey";

const STATUS_WORD: Readonly<Record<JourneyStageStatus, string>> = Object.freeze({
  pending: "pending",
  running: "running",
  awaiting_approval: "awaiting approval",
  blocked: "blocked",
  partial: "partial",
  succeeded: "done",
  failed: "failed",
  canceled: "canceled",
});

/** a one-character text glyph per status (read with the word, never alone) */
const STATUS_GLYPH: Readonly<Record<JourneyStageStatus, string>> = Object.freeze({
  pending: "○", // ○
  running: "…", // …
  awaiting_approval: "!",
  blocked: "✕", // ✕
  partial: "◐", // ◐
  succeeded: "✓", // ✓
  failed: "✕", // ✕
  canceled: "–", // –
});

const STATUS_TEXT_CLASS: Readonly<Record<JourneyStageStatus, string>> = Object.freeze({
  pending: "text-zinc-500",
  running: "text-zinc-200",
  awaiting_approval: "text-amber-200",
  blocked: "text-red-300",
  partial: "text-amber-200",
  succeeded: "text-zinc-300",
  failed: "text-red-300",
  canceled: "text-zinc-500",
});

export function JourneyStrip({ view, onAction, compact = false }: { view: JourneyView; onAction: (actionId: JourneyActionId) => void; compact?: boolean }) {
  const next = view.nextAction;
  return (
    <div data-testid="journey-strip" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-4 text-zinc-400">
      <ol role="list" aria-label="Workflow stages" className="flex flex-wrap items-center gap-1">
        {view.stages.map((stage) => {
          const isCurrent = stage.id === view.current;
          const word = STATUS_WORD[stage.status];
          const showWord = !compact && stage.status !== "pending" && stage.status !== "succeeded";
          return (
            <li
              key={stage.id}
              data-testid={`journey-stage-${stage.id}`}
              data-status={stage.status}
              data-current={isCurrent ? "true" : undefined}
              aria-current={isCurrent ? "step" : undefined}
              title={stage.note ? `${stage.label}: ${word} - ${stage.note}` : `${stage.label}: ${word}`}
              className={
                isCurrent
                  ? "flex items-center gap-1 rounded border border-zinc-400 bg-zinc-800 px-1.5 py-0.5 font-medium text-zinc-100"
                  : "flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5"
              }
            >
              <span aria-hidden="true" className={STATUS_TEXT_CLASS[stage.status]}>{STATUS_GLYPH[stage.status]}</span>
              <span>{stage.label}</span>
              {showWord ? (
                <span className={`${STATUS_TEXT_CLASS[stage.status]}`}>({word})</span>
              ) : (
                <span className="sr-only">({word})</span>
              )}
              {!compact && stage.note && isCurrent ? <span className="text-zinc-500">- {stage.note}</span> : null}
            </li>
          );
        })}
      </ol>
      {next ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="journey-next-action"
            data-action-id={next.actionId}
            onClick={() => onAction(next.actionId)}
            disabled={!next.enabled}
            title={next.enabled ? next.label : next.reason}
            className="rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-[12px] font-medium text-zinc-100 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-zinc-800"
          >
            {next.label}
          </button>
          {!next.enabled && next.reason ? (
            <span data-testid="journey-next-action-reason" className="text-zinc-400">{next.reason}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
