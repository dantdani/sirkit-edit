/**
 * [B18-D I8] The chat's "Undo this change" (chat-execution-ux.md §1 item 10; §2 R1-2, R1-5).
 *  - The click carries only an identifier; the project timeline undoes the newest operation ONLY if it is exactly the
 *    entry's transaction, comparing it with its OWN recorded reference — so a stale or forged id can only cause a refusal
 *    (NOT_LATEST), and the store's undo is never called for it. Without an expectation, undoLatest is unchanged.
 *  - What the entry's button shows: available only for a committed change that is still undoable, still the newest
 *    operation (a commit or a redo of exactly that transaction) and with no AI change in flight; otherwise it says why.
 *  - The result is written into the entry: a success names one history step; a refusal carries the timeline's message.
 */
import { describe, expect, it } from "vitest";
import type { PublicExecutionGrant } from "../../engineering/execution-grant";
import { isStoredChatMessage } from "@/lib/persistence";
import { entryEditorOutcome, entryExecuting, entryFromGrant, entryToLogMessage, entryUndoAvailability, entryUndoResult } from "../chat-run-view";
import { ProjectOperationTimeline } from "../operation-timeline";

const head = (n: number) => ({ store: "pcb", historyId: "pcb-history-1", headSequence: n, entryCount: n }) as const;

describe("B18-D I8 — the timeline undoes exactly the expected transaction", () => {
  it("NOT_LATEST when the newest operation is another transaction; the store's undo is never called", async () => {
    const timeline = new ProjectOperationTimeline();
    let current: ReturnType<typeof head> = head(2);
    let undos = 0;
    timeline.bindStore("pcb", { undo: () => { undos += 1; current = head(1); }, head: () => current });
    timeline.record({ store: "pcb", kind: "commit", label: "AI: R3 at (8.000, 5.000) mm", actor: "ai", head: head(1), ref: { transactionId: "tx-ai" } });
    timeline.record({ store: "pcb", kind: "commit", label: "human move", actor: "human", head: head(2), ref: { transactionId: "tx-human" } });
    expect(await timeline.undoLatest({ expectTransactionId: "tx-ai" })).toMatchObject({ ok: false, code: "NOT_LATEST", message: "That change is no longer the latest operation; nothing was undone." });
    expect(undos).toBe(0);
    expect(await timeline.undoLatest({ expectTransactionId: "tx-human" })).toMatchObject({ ok: true, operation: { label: "human move" } });
    expect(undos).toBe(1);
  });

  it("a forged id can only cause a refusal; without an expectation undoLatest behaves as before", async () => {
    const timeline = new ProjectOperationTimeline();
    let undos = 0;
    const current = head(1);
    timeline.bindStore("pcb", { undo: () => { undos += 1; }, head: () => current });
    timeline.record({ store: "pcb", kind: "commit", label: "AI move", actor: "ai", head: current, ref: { transactionId: "tx-1" } });
    expect(await timeline.undoLatest({ expectTransactionId: "tx-forged" })).toMatchObject({ ok: false, code: "NOT_LATEST" });
    expect(undos).toBe(0);
    expect(await timeline.undoLatest()).toMatchObject({ ok: true });
    expect(undos).toBe(1);
  });
});

const grant = {
  grantId: `xg-${"a".repeat(32)}`,
  binding: {
    operation: { family: "pcb.move-footprint", tier: 1, decision: "preview_then_confirm", autonomy: { mode: "proposal_only", revision: 1 } },
    targets: { resolvedFrom: "named", objectIds: ["fp-r3"], netIds: [], kinds: ["footprint"] },
    proposal: { operations: [{ kind: "move_footprint", footprintId: "fp-r3", at: { x: 52_000_000, y: 47_480_000 } }], preview: { before: "R3 at (50.000, 47.480) mm", after: "R3 at (52.000, 47.480) mm", warnings: [] } },
    instruction: { excerpt: "Move R3 2 mm to the right.", explicit: { proven: false, grammarId: "pcb.move-footprint", grammarVersion: "1.4.0", coverage: "unproven", derivedOperationsDigest: null } },
  },
} as unknown as PublicExecutionGrant;
const refOf = (id: string) => (id === "fp-r3" ? "R3" : null);
const receipt = { transactionId: "tx:pcb.move-footprint:1", pcbRevisionBefore: "pcb2-aaaaaaaaaaaaaaaaaaaa", pcbRevisionAfter: "pcb2-bbbbbbbbbbbbbbbbbbbb", headSequenceAfter: 2 };
const awaiting = entryFromGrant({ grant, decision: "preview_then_confirm" }, refOf);
const committed = entryEditorOutcome(entryExecuting(awaiting), { ok: true, status: "committed", receipt, settled: "settled", validations: { drc: { ran: true, violations: 7 } }, undoEligible: true, presetId: "jlcpcb-2l" });
const tx = receipt.transactionId;
const LATEST = "No longer the latest operation — use the revision history.";

describe("B18-D I8 — what the entry's Undo shows", () => {
  it("no live Undo unless the entry is committed with a transaction", () => {
    expect(entryUndoAvailability(awaiting, { kind: "commit", ref: { transactionId: tx } }, false)).toBeNull();
    expect(entryUndoAvailability(entryExecuting(awaiting), { kind: "commit", ref: { transactionId: tx } }, false)).toBeNull();
    expect(entryUndoAvailability({ ...committed, transaction: null }, { kind: "commit", ref: { transactionId: tx } }, false)).toBeNull();
  });

  it("available only while its transaction is the newest commit or redo, with no AI change in flight", () => {
    expect(committed.state).toBe("committed");
    expect(entryUndoAvailability(committed, { kind: "commit", ref: { transactionId: tx } }, false)).toEqual({ eligible: true, reason: null });
    expect(entryUndoAvailability(committed, { kind: "redo", ref: { transactionId: tx } }, false)).toEqual({ eligible: true, reason: null });
    expect(entryUndoAvailability(committed, { kind: "commit", ref: { transactionId: "tx-human" } }, false)).toEqual({ eligible: false, reason: LATEST });
    // an undo of a LATER change leaves this change at the head, but the newest operation is an undo: the timeline would refuse
    expect(entryUndoAvailability(committed, { kind: "undo", ref: { transactionId: tx } }, false)).toEqual({ eligible: false, reason: "Not available here after a later undo — it is on top again: the editor's Undo reverts it." }); // [B18-D review] pin moved: the reason names the Undo that works
    expect(entryUndoAvailability(committed, undefined, false)).toEqual({ eligible: false, reason: LATEST });
    expect(entryUndoAvailability(committed, { kind: "commit", ref: { transactionId: tx } }, true)).toEqual({ eligible: false, reason: "Paused — an AI change is being made." });
    expect(entryUndoAvailability({ ...committed, undoEligible: false }, { kind: "commit", ref: { transactionId: tx } }, false)).toEqual({ eligible: false, reason: "No longer undoable from here — use the revision history." });
  });

  it("a success is written into the entry once (one history step; no longer undoable); a refusal carries the timeline's message verbatim", () => {
    const undone = entryUndoResult(committed, { ok: true });
    expect(undone).toMatchObject({ state: "committed", undoEligible: false, undoResult: { ok: true } });
    expect(entryUndoAvailability(undone, { kind: "undo", ref: { transactionId: "tx-before" } }, false)).toEqual({ eligible: false, reason: "Already undone — the editor's Redo brings it back." });
    // [B18-D review] pin moved: after the editor's Redo the reason no longer says "Already undone"; the chat's Undo stays one-shot (D-A8)
    expect(entryUndoAvailability(undone, { kind: "redo", ref: { transactionId: tx } }, false)).toEqual({ eligible: false, reason: "Undone once from here, and the editor's Redo brought it back — use the editor's Undo, or say “Undo that.”" });
    const message = entryToLogMessage(undone);
    const rows = message.entries.map((row) => row.text);
    expect(rows.filter((text) => text === "Undone by you — the editor's own Undo reversed this change (one history step).")).toHaveLength(1);
    expect(rows.filter((text) => /one canonical transaction, undoable/.test(text))).toHaveLength(0);
    expect(rows.filter((text) => /^Undo: /.test(text))).toHaveLength(0);
    expect(message.status).toBe("done");
    expect(isStoredChatMessage(message)).toBe(true);

    const refused = entryUndoResult(committed, { ok: false, message: "That change is no longer the latest operation; nothing was undone." });
    expect(refused.undoEligible).toBe(true); // a refusal changes nothing; what the button shows is decided from the timeline
    const refusedRows = entryToLogMessage(refused).entries;
    expect(refusedRows.filter((row) => row.text === "Not undone — That change is no longer the latest operation; nothing was undone." && row.status === "error")).toHaveLength(1);
  });
});
