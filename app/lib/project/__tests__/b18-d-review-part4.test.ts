/**
 * [B18-D review, part 4] The completeness critic's gaps:
 *  - the answer label is true also when the change was made but not yet confirmed (the explicit, unsettled case);
 *  - the in-progress lines never claim "undoable" and show how long the assistant waits for the editor;
 *  - a recovery result settles a live entry to what the sweep established (never "Executing …" beside "Recovered …");
 *  - after a LATER change was undone, the chat Undo's reason names the editor's Undo, which works;
 *  - a schematic edit proposal's answer is the page's own sentence; the model's note is only a labelled note.
 */
import { describe, expect, it } from "vitest";
import { EXECUTION_SETTLEMENT_TIMEOUT_MS, type PublicExecutionGrant } from "../../engineering/execution-grant";
import { LABEL_BEFORE_CHANGE, NOTE_PREFIX, editProposalMessages, entryCancelled, entryEditorOutcome, entryExecuting, entryFromGrant, entryRecovery, entryToLogMessage, entryUndoAvailability } from "../chat-run-view";

const grant = (decision: "execute_explicit" | "preview_then_confirm"): PublicExecutionGrant => ({
  grantId: `xg-${"d".repeat(32)}`,
  binding: {
    operation: { family: "pcb.move-footprint", tier: 1, decision, autonomy: { mode: decision === "execute_explicit" ? "execute_explicit_tier1" : "proposal_only", revision: 1 } },
    targets: { resolvedFrom: "named", objectIds: ["fp-r3"], netIds: [], kinds: ["footprint"] },
    proposal: { operations: [{ kind: "move_footprint", footprintId: "fp-r3", at: { x: 52_000_000, y: 47_480_000 } }], preview: { before: "R3 at (50.000, 47.480) mm", after: "R3 at (52.000, 47.480) mm", warnings: [] } },
    instruction: { excerpt: "Move R3 2 mm to the right.", explicit: { proven: decision === "execute_explicit", grammarId: "pcb.move-footprint", grammarVersion: "1.4.0", coverage: decision === "execute_explicit" ? "exact" : "unproven", derivedOperationsDigest: null } },
  },
}) as unknown as PublicExecutionGrant;
const refOf = (id: string) => (id === "fp-r3" ? "R3" : null);
const receipt = { transactionId: "tx:pcb.move-footprint:9", pcbRevisionBefore: "pcb2-aaaaaaaaaaaaaaaaaaaa", pcbRevisionAfter: "pcb2-bbbbbbbbbbbbbbbbbbbb", headSequenceAfter: 4 };

describe("B18-D review, part 4 — what the chat asserts stays true", () => {
  it("the answer label never says no change was made", () => {
    expect(LABEL_BEFORE_CHANGE).toBe("Written before the outcome of this change was confirmed — the entry above is authoritative.");
    expect(LABEL_BEFORE_CHANGE).not.toMatch(/before any change was made/);
  });

  it("the in-progress lines never claim 'undoable' and show the wait, which matches the settlement budget", () => {
    const issued = entryFromGrant({ grant: grant("execute_explicit"), decision: "execute_explicit" }, refOf);
    const wait = `up to ${EXECUTION_SETTLEMENT_TIMEOUT_MS / 1000} s`;
    for (const entry of [issued, entryExecuting(issued)]) {
      const first = entryToLogMessage(entry).entries[0]!.text;
      expect(first, first).not.toMatch(/undoable/);
      expect(first, first).toContain(wait);
    }
  });
});

describe("B18-D review, part 4 — recovery settles a live entry", () => {
  it("each sweep result becomes the entry's state; a terminal entry keeps its own", () => {
    const live = entryExecuting(entryFromGrant({ grant: grant("execute_explicit"), decision: "execute_explicit" }, refOf));
    expect(entryRecovery(live, "adopted-and-settled")).toMatchObject({ state: "committed", undoEligible: false, serverRecord: "settled" });
    expect(entryRecovery(live, "settled-from-receipt").state).toBe("committed");
    expect(entryRecovery(live, "abandoned-not-committed")).toMatchObject({ state: "not_made", failure: { headline: "Recovered: an AI change that never landed was closed. Nothing was changed." } });
    expect(entryRecovery(live, "refused-poisoned").state).toBe("landed_unverified");
    expect(entryRecovery(live, "left-in-flight").state).toBe("executing");
    const recovered = entryToLogMessage(entryRecovery(live, "adopted-and-settled")).entries.map((row) => row.text);
    expect(recovered.some((text) => /Executing in the PCB editor/.test(text))).toBe(false);
    const cancelled = entryCancelled(entryFromGrant({ grant: grant("preview_then_confirm"), decision: "preview_then_confirm" }, refOf));
    expect(entryRecovery(cancelled, "adopted-and-settled").state).toBe("cancelled");
  });
});

describe("B18-D review, part 4 — the chat Undo after a later undo", () => {
  it("names the editor's Undo when this change is on top again; otherwise points to the revision history", () => {
    const committed = entryEditorOutcome(entryExecuting(entryFromGrant({ grant: grant("execute_explicit"), decision: "execute_explicit" }, refOf)), { ok: true, status: "committed", receipt, settled: "settled", validations: { drc: { ran: true, violations: 0 } }, undoEligible: true, presetId: "jlcpcb-2l" });
    expect(entryUndoAvailability(committed, { kind: "undo", ref: { transactionId: receipt.transactionId } }, false)).toEqual({ eligible: false, reason: "Not available here after a later undo — it is on top again: the editor's Undo reverts it." });
    expect(entryUndoAvailability(committed, { kind: "undo", ref: { transactionId: "tx-other" } }, false)).toEqual({ eligible: false, reason: "No longer the latest operation — use the revision history." });
  });
});

describe("B18-D review, part 4 — Rule 2 on the schematic edit route", () => {
  it("the answer is the page's own sentence; the model's note is a labelled note", () => {
    const withNote = editProposalMessages("Changed R1 to 4.7 kΩ.");
    expect(withNote.answer).toBe('Edit proposal prepared. Review the exact operations and choose "Apply exact proposal" — nothing has been changed yet.');
    expect(withNote.answer).not.toContain("Changed R1");
    expect(withNote.note).toBe(`${NOTE_PREFIX}Changed R1 to 4.7 kΩ.`);
    expect(editProposalMessages("   ").note).toBeNull();
    expect(editProposalMessages(undefined).note).toBeNull();
  });
});
