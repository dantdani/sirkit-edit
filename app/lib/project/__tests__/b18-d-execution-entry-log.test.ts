/**
 * [B18-D I6] The chat execution entry as a chat log message (chat-execution-ux.md §1, "The entry itself"): it persists
 * through the EXISTING stored-chat log shape (the stored-message validator accepts it unchanged), the pinned phrases
 * appear in it exactly once, its state survives a reload through the first row's id, and a restored entry reads as
 * interrupted when it was still pending.
 */
import { describe, expect, it } from "vitest";
import type { PublicExecutionGrant } from "../../engineering/execution-grant";
import { isStoredChatMessage } from "@/lib/persistence";
import { EXECUTION_ENTRY_ID_PREFIX, entryEditorOutcome, entryExecuting, entryFromGrant, entryStateOfLogMessage, entryToLogMessage } from "../chat-run-view";

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
const texts = (message: ReturnType<typeof entryToLogMessage>) => message.entries.map((row) => row.text);
const count = (haystack: string[], needle: RegExp) => haystack.filter((text) => needle.test(text)).length;

describe("B18-D I6 — the chat execution entry as a persistable log message", () => {
  it("an awaiting entry: id xlog-<grantId>, running, the confirmation phrase exactly once, every row the entry carries", () => {
    const message = entryToLogMessage(entryFromGrant({ grant, decision: "preview_then_confirm" }, refOf));
    expect(message.id).toBe(`${EXECUTION_ENTRY_ID_PREFIX}${grant.grantId}`);
    expect(message).toMatchObject({ role: "log", status: "running", title: "AI change — pcb.move-footprint — R3 at (52.000, 47.480) mm" });
    const rows = texts(message);
    expect(count(rows, /^Change ready for your confirmation in the PCB editor — R3 at \(52\.000, 47\.480\) mm; nothing has changed yet$/)).toBe(1);
    expect(rows).toEqual(expect.arrayContaining(["Tier 1 · reversible edit", "You asked (as recorded): “Move R3 2 mm to the right.”", "Targets: R3 · Nets named: none", "Operation 1: Place R3 at (52.000, 47.480) mm"]));
    expect(count(rows, /^Confirmation: Required — /)).toBe(1);
    expect(count(rows, /AI change committed by your editor/)).toBe(0);
    expect(entryStateOfLogMessage(message)).toBe("awaiting_confirmation");
  });

  it("committed: the committed phrase exactly once (with the checks and undo), the transaction row, done; the confirmation phrase is gone", () => {
    const committed = entryEditorOutcome(entryExecuting(entryFromGrant({ grant, decision: "preview_then_confirm" }, refOf)), { ok: true, status: "committed", receipt, settled: "settled", validations: { drc: { ran: true, violations: 7 } }, undoEligible: true, presetId: "jlcpcb-2l" });
    const message = entryToLogMessage(committed);
    const rows = texts(message);
    expect(message.status).toBe("done");
    expect(count(rows, /^AI change committed by your editor \(one canonical transaction, undoable\) — design rule check \(jlcpcb-2l\): 7 errors/)).toBe(1);
    expect(count(rows, /Change ready for your confirmation/)).toBe(0);
    expect(count(rows, /^Transaction tx:pcb\.move-footprint:1 · revision pcb2-a+… → pcb2-b+… · history #2 · server record: settled$/)).toBe(1);
    expect(count(rows, /^Undo: while it is the latest change — “Undo this change” here, the editor's Undo \(one step\), or say “Undo that\.”$/)).toBe(1); // [B18-D review] pin moved: not a present-tense claim
    expect(entryStateOfLogMessage(message)).toBe("committed");
    const notUndoable = entryToLogMessage({ ...committed, undoEligible: false });
    expect(count(texts(notUndoable), /^AI change committed by your editor \(one canonical transaction\)/)).toBe(1);
    expect(count(texts(notUndoable), /no longer the latest change/)).toBe(1);
  });

  it("a refusal is an error entry with its headline and next step; the stored-chat validator accepts every entry unchanged", () => {
    const refused = entryToLogMessage(entryEditorOutcome(entryFromGrant({ grant, decision: "preview_then_confirm" }), { ok: false, code: "stale-revision", changed: false }));
    expect(refused.status).toBe("error");
    expect(texts(refused)[0]).toMatch(/^Not made — the board changed since the assistant prepared it\. Nothing was changed\.$/);
    expect(count(texts(refused), /^Next: Ask again\.$/)).toBe(1);
    for (const message of [refused, entryToLogMessage(entryFromGrant({ grant, decision: "execute_explicit" }))]) expect(isStoredChatMessage(message)).toBe(true);
  });

  it("the state survives a reload through the first row's id; anything that is not an entry has no state", () => {
    const stored = JSON.parse(JSON.stringify(entryToLogMessage(entryExecuting(entryFromGrant({ grant, decision: "execute_explicit" }))))) as { id: string; entries: Array<{ id: string }> };
    expect(entryStateOfLogMessage(stored)).toBe("executing");
    expect(entryStateOfLogMessage({ id: "log-123", entries: [{ id: "x" }] })).toBeNull();
    expect(entryStateOfLogMessage({ id: `${EXECUTION_ENTRY_ID_PREFIX}forged`, entries: [{ id: "xlog-forged:state:everything-is-fine" }] })).toBeNull();
    expect(entryStateOfLogMessage({ id: `${EXECUTION_ENTRY_ID_PREFIX}empty`, entries: [] })).toBeNull();
  });
});
