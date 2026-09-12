/**
 * [B18-E E1] Scenario 6's truth ("Undo that," then refresh, then redo), in the chat:
 *  - an AI redo's hint names no chat phrase: the minter refuses to undo an AI undo or redo (b18-c-undo-redo pins the
 *    refusal, and that every phrase a hint names mints);
 *  - a committed entry restored after a reload gets an undo hint that stays true — the editor's one-step Undo and the chat's
 *    Undo do not survive a reload — while a recorded Undo result, a pending entry and every other message are unchanged;
 *  - "nothing to undo or redo" is said plainly on the tool line.
 */
import { describe, expect, it } from "vitest";
import type { PublicExecutionGrant } from "../../engineering/execution-grant";
import { RESTORED_UNDO_HINTS, entryEditorOutcome, entryExecuting, entryFromGrant, entryToLogMessage, entryUndoResult, restoredEntryLog, toolLineLabel } from "../chat-run-view";

const grant = (replay: "undo" | "redo" | null): PublicExecutionGrant => ({
  grantId: `xg-${replay ?? "c"}${"0".repeat(31)}`,
  binding: {
    operation: { family: replay ? "pcb.undo-redo-canonical" : "pcb.silkscreen-text", tier: 1, decision: "execute_explicit", autonomy: { mode: "execute_explicit_tier1", revision: 1 } },
    targets: { resolvedFrom: "named", objectIds: [], netIds: [], kinds: [] },
    proposal: { operations: [], preview: { before: "", after: replay ? `${replay} of the latest AI change` : "silkscreen text REV B", warnings: [] }, ...(replay ? { replay: { direction: replay, referencedTransactionId: "tx:0", referencedGrantId: "xg-0" } } : {}) },
    instruction: { excerpt: replay === "undo" ? "Undo that." : replay === "redo" ? "Redo." : "Add silkscreen text REV B.", explicit: { proven: true, grammarId: "x", grammarVersion: "1", coverage: "whole-message", derivedOperationsDigest: null } },
  },
}) as unknown as PublicExecutionGrant;
const receipt = { transactionId: "tx:1", pcbRevisionBefore: "pcb2-aaaaaaaaaaaaaaaaaaaa", pcbRevisionAfter: "pcb2-bbbbbbbbbbbbbbbbbbbb", headSequenceAfter: 3 };
const committed = (replay: "undo" | "redo" | null, undoEligible = true) => entryEditorOutcome(entryExecuting(entryFromGrant({ grant: grant(replay), decision: "execute_explicit" })), { ok: true, status: "committed", receipt, settled: "settled", undoEligible });
const undoRow = (message: { entries: ReadonlyArray<{ id: string; text: string }> }) => message.entries.find((row) => row.id.endsWith(":undo"))!.text;
const phrases = (text: string) => [...text.matchAll(/“([^”]+)”/g)].map((match) => match[1]);
/** What a reload sees: the stored JSON of the message. */
const stored = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("B18-E E1 — the hint names only what the assistant will do", () => {
  it("a change names “Undo that.”; an AI undo names “Redo.”; an AI redo names no chat phrase", () => {
    expect(phrases(undoRow(entryToLogMessage(committed(null))))).toEqual(["Undo that."]);
    expect(phrases(undoRow(entryToLogMessage(committed("undo"))))).toEqual(["Redo."]);
    expect(undoRow(entryToLogMessage(committed("redo")))).toBe("Undo: while it is the latest change — the editor's Undo (one step) removes the change again.");
    expect(phrases(undoRow(entryToLogMessage(committed("redo"))))).toEqual([]);
  });
});

describe("B18-E E1 — a committed entry restored after a reload", () => {
  it("gets a hint that stays true: the editor's one-step Undo is gone; the chat phrase follows the direction", () => {
    expect(undoRow(restoredEntryLog(stored(entryToLogMessage(committed(null)))))).toBe(RESTORED_UNDO_HINTS.change);
    expect(undoRow(restoredEntryLog(stored(entryToLogMessage(committed("undo")))))).toBe(RESTORED_UNDO_HINTS.undo);
    expect(undoRow(restoredEntryLog(stored(entryToLogMessage(committed("redo")))))).toBe(RESTORED_UNDO_HINTS.redo);
    for (const hint of Object.values(RESTORED_UNDO_HINTS)) expect(hint).not.toMatch(/editor's Undo \(one step\)|Undo this change/);
  });

  it("an entry stored before these hints (the chat's button named) is restored the same way", () => {
    const legacy = (text: string) => { const message = stored(entryToLogMessage(committed(null))); return { ...message, entries: message.entries.map((row) => (row.id.endsWith(":undo") ? { ...row, text } : row)) }; };
    expect(undoRow(restoredEntryLog(legacy("Undo: while it is the latest change — “Undo this change” here, the editor's Undo (one step), or say “Undo that.”")))).toBe(RESTORED_UNDO_HINTS.change);
    expect(undoRow(restoredEntryLog(legacy("Undo: while it is the latest change — “Undo this change” here or the editor's Undo (one step) re-applies the change; or say “Redo.”")))).toBe(RESTORED_UNDO_HINTS.undo);
    expect(undoRow(restoredEntryLog(legacy("Undo: while it is the latest change — “Undo this change” here or the editor's Undo (one step) removes the change again; or say “Undo that.”")))).toBe(RESTORED_UNDO_HINTS.redo);
  });

  it("keeps what is still true: the not-undoable line, a recorded Undo result, a pending entry and any other message", () => {
    const notUndoable = stored(entryToLogMessage(committed(null, false)));
    expect(restoredEntryLog(notUndoable)).toEqual(notUndoable);
    const undone = stored(entryToLogMessage(entryUndoResult(committed(null), { ok: true, afterSeq: 4 })));
    expect(restoredEntryLog(undone)).toEqual(undone);
    const pending = stored(entryToLogMessage(entryExecuting(entryFromGrant({ grant: grant(null), decision: "execute_explicit" }))));
    expect(restoredEntryLog(pending)).toEqual(pending);
    const other = { id: "log-1", role: "log", title: "Working", status: "done", entries: [{ id: "r1", text: "Undo: while it is the latest change — anything", status: "done" }] };
    expect(restoredEntryLog(other)).toEqual(other);
  });
});

describe("B18-E E1 — nothing to undo or redo, said plainly", () => {
  it("the tool line names the reason, never the bare code; other refusals keep their code", () => {
    expect(toolLineLabel({ title: "Undo or redo the assistant's latest change", tier: 1, ok: false, status: "nothing_to_replay" })).toBe("T1 · Undo or redo the assistant's latest change — nothing to undo or redo — the assistant acts only on its own latest change; nothing was changed");
    expect(toolLineLabel({ title: "Move footprints", tier: 1, ok: false, status: "invalid_input" })).toBe("T1 · Move footprints — refused (invalid_input)");
  });
});
