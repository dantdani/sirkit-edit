"use client";

/**
 * [B18-D I8] "Undo this change" on a committed AI change's chat entry (chat-execution-ux.md §1 item 10; §2 R1-2, R1-5).
 * The button passes NOTHING: the page knows which change the entry is, and asks the project timeline to undo the newest
 * operation only if it is still exactly that transaction (NOT_LATEST otherwise) — the PCB store's own Undo, one history
 * step. It applies nothing and holds no authority; when the change can no longer be undone from here it says why.
 */
import { useId } from "react";
import { Button } from "@/components/ui/button";

export interface ExecutionEntryActionsProps {
  /** Whether the change is still the latest, undoable operation. */
  eligible: boolean;
  /** Why it is not (shown beside the disabled button), or null. */
  reason: string | null;
  onUndo: () => void;
}

export function ExecutionEntryActions({ eligible, reason, onUndo }: ExecutionEntryActionsProps) {
  const reasonId = useId(); // [B18-D review] the disabled button is described by its reason for assistive technology
  const showReason = !eligible && Boolean(reason);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2" data-testid="execution-entry-actions">
      <Button size="sm" variant="outline" data-testid="execution-undo" disabled={!eligible} aria-describedby={showReason ? reasonId : undefined} onClick={() => onUndo()}>
        Undo this change
      </Button>
      {showReason ? <span id={reasonId} className="text-[11px] text-zinc-500" data-testid="execution-undo-reason">{reason}</span> : null}
    </div>
  );
}
