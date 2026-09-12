/**
 * [B18-D review 2] The chat's Undo reasons read the project timeline as the PCB editor records it. This drives a REAL PCB
 * history through the editor's own recording step (`pcbHistoryStep`, which PcbEditor calls) into a real
 * ProjectOperationTimeline, so each reason is checked against what the recording actually says and against the history
 * itself (canRedo, redoLabel):
 *  - after a later change is undone, the AI change is on top again (the undo's ref is the head it returned to); once the AI
 *    change is undone itself, it is not;
 *  - after the chat's Undo the reason follows the editor's Redo, a later commit and a later undo.
 */
import { describe, expect, it } from "vitest";
import { createHistory, type PcbHistory } from "../../pcb/history";
import { makeBoard, makeInstance, makeResistorDef } from "../../pcb/__tests__/autoplace-fixture";
import type { PcbBoard } from "../../pcb/types";
import { ProjectOperationTimeline, pcbHistoryMark, pcbHistoryStep } from "../operation-timeline";
import { entryUndoAvailability, entryUndoResult, type ExecutionEntry } from "../chat-run-view";

function board(): PcbBoard {
  const def = makeResistorDef();
  return makeBoard(40, 30, [makeInstance("r3", def, { x: 5, y: 5 }, { "1": 1, "2": 2 }), makeInstance("r4", def, { x: 30, y: 22 }, { "1": 1, "2": 0 })], 2);
}

/** A real history whose every change is recorded exactly as the PCB editor records it. */
function recorded(): { history: PcbHistory; timeline: ProjectOperationTimeline } {
  const history = createHistory(board());
  const timeline = new ProjectOperationTimeline(500, () => 0);
  let mark = pcbHistoryMark(history);
  history.subscribe(() => {
    const next = pcbHistoryStep(history, mark);
    mark = next.mark;
    const applied = history.entries.filter((entry) => entry.state === "applied").length;
    if (next.step) timeline.record({ store: "pcb", ...next.step, head: { store: "pcb", historyId: "h", headSequence: applied, entryCount: applied } });
  });
  return { history, timeline };
}

const move = (history: PcbHistory, label: string, transactionId: string, actor: "ai" | "human"): void =>
  history.execute(label, (draft) => { draft.footprints[0]!.at.x += 1_000_000; }, { actor, transactionId, operationType: "move", affectedObjects: ["r3"] });

const committed = (transactionId: string): ExecutionEntry => ({
  grantId: `xg-${"f".repeat(32)}`, family: "pcb.move-footprint", decision: "execute_explicit", tier: "T1", state: "committed",
  asked: "Move R3 1 mm to the right.", understood: "pcb.move-footprint — R3 at (6.000, 5.000) mm", targets: ["R3"], nets: "no nets", operations: [], confirmation: "not required",
  transaction: { id: transactionId, revisionBefore: null, revisionAfter: null, headSequenceAfter: 1 }, serverRecord: "settled", checks: null, failure: null, recovery: null, undoEligible: true,
});

describe("B18-D review 2 — the Undo reasons against a real, recorded PCB history", () => {
  it("after a later change is undone the AI change is on top again; once it is undone itself it is not", () => {
    const { history, timeline } = recorded();
    move(history, "AI: R3", "tx-C", "ai");
    move(history, "human move", "tx-L", "human");
    const entry = committed("tx-C");
    const reason = () => entryUndoAvailability(entry, timeline.latest(), false, timeline.entries())?.reason;
    expect(reason()).toBe("No longer the latest operation — use the revision history.");
    history.undo(); // the later change
    expect(timeline.latest()).toMatchObject({ kind: "undo", ref: { transactionId: "tx-C" } }); // the head it returned to
    expect(reason()).toBe("Not available here after a later undo — it is on top again: the editor's Undo reverts it.");
    expect(history.undoLabel).toBe("AI: R3"); // and it is: the editor's Undo reverts exactly the AI change
    history.undo(); // the AI change itself
    expect(timeline.latest()?.ref?.transactionId).not.toBe("tx-C");
    expect(reason()).not.toMatch(/on top again/);
  });

  it("after the chat's Undo, each reason is what the history says: Redo brings it back, Redo brought it back, later changes above it, on top again", () => {
    const { history, timeline } = recorded();
    move(history, "AI: R3", "tx-C", "ai");
    const commit = timeline.latest()!;
    expect(entryUndoAvailability(committed("tx-C"), commit, false, timeline.entries())).toEqual({ eligible: true, reason: null });
    history.undo(); // what the chat's Undo runs: the editor's own undo, one step
    const undone = entryUndoResult(committed("tx-C"), { ok: true, afterSeq: commit.seq });
    const reason = () => entryUndoAvailability(undone, timeline.latest(), false, timeline.entries())?.reason;
    expect(reason()).toBe("Already undone — the editor's Redo brings it back.");
    expect(history.canRedo && history.redoLabel === "AI: R3").toBe(true);
    history.redo();
    expect(reason()).toBe("Undone once from here, and the editor's Redo brought it back — use the editor's Undo, or say “Undo that.”");
    move(history, "human move", "tx-L", "human");
    expect(reason()).toBe("Undone once from here and redone since; later changes are above it — use the revision history.");
    history.undo(); // the later change
    expect(reason()).toBe("Undone once from here and redone since — it is on top again: the editor's Undo reverts it.");
    expect(history.undoLabel).toBe("AI: R3");
    history.undo(); // the AI change again
    expect(reason()).toBe("Already undone — the editor's Redo brings it back.");
    expect(history.redoLabel).toBe("AI: R3");
  });

  it("a commit after the chat's Undo clears the editor's Redo, and the reason says so", () => {
    const { history, timeline } = recorded();
    move(history, "AI: R3", "tx-C", "ai");
    const commit = timeline.latest()!;
    history.undo();
    const undone = entryUndoResult(committed("tx-C"), { ok: true, afterSeq: commit.seq });
    move(history, "human move", "tx-L", "human");
    // a commit made after an undo is recorded as a commit (counting mistook it for a redo: it clears the redo stack)
    expect(timeline.latest()).toMatchObject({ kind: "commit", ref: { transactionId: "tx-L" } });
    expect(history.canRedo).toBe(false);
    expect(entryUndoAvailability(undone, timeline.latest(), false, timeline.entries())?.reason).toBe("Already undone — a later change cleared the editor's Redo; ask again, or use the revision history.");
  });
});
