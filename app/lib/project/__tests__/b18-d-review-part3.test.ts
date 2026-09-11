/**
 * [B18-D review, part 3] The UX verifier's remaining findings:
 *  - an explicit grant refused by the editor's live pre-check names that reason (it used to read "Replaced …", then "the
 *    editing session was replaced"), and a later server retirement keeps a terminal entry the editor already reported —
 *    while a committed entry the server calls retired still fails safe to "landed, unverified";
 *  - the committed line never claims "undoable" (a snapshot that stops being true); the undo hint is conditional;
 *  - an AI undo or redo entry's hint follows its direction.
 */
import { describe, expect, it } from "vitest";
import type { PublicExecutionGrant } from "../../engineering/execution-grant";
import { entryEditorOutcome, entryExecuting, entryFromGrant, entrySettled, entryToLogMessage, type ExecutionEntry } from "../chat-run-view";

type Replay = { direction: "undo" | "redo"; referencedTransactionId: string; referencedGrantId: string };
const grantWith = (replay?: Replay): PublicExecutionGrant => ({
  grantId: `xg-${"c".repeat(32)}`,
  binding: {
    operation: { family: replay ? "pcb.undo-redo-canonical" : "pcb.move-footprint", tier: 1, decision: "execute_explicit", autonomy: { mode: "execute_explicit_tier1", revision: 1 } },
    targets: { resolvedFrom: "named", objectIds: ["fp-r3"], netIds: [], kinds: ["footprint"] },
    proposal: { operations: [{ kind: "move_footprint", footprintId: "fp-r3", at: { x: 52_000_000, y: 47_480_000 } }], preview: { before: "R3 at (50.000, 47.480) mm", after: "R3 at (52.000, 47.480) mm", warnings: [] }, ...(replay ? { replay } : {}) },
    instruction: { excerpt: "Move R3 2 mm to the right.", explicit: { proven: true, grammarId: "pcb.move-footprint", grammarVersion: "1.4.0", coverage: "exact", derivedOperationsDigest: "digest" } },
  },
}) as unknown as PublicExecutionGrant;
const refOf = (id: string) => (id === "fp-r3" ? "R3" : null);
const receipt = { transactionId: "tx:pcb.move-footprint:1", pcbRevisionBefore: "pcb2-aaaaaaaaaaaaaaaaaaaa", pcbRevisionAfter: "pcb2-bbbbbbbbbbbbbbbbbbbb", headSequenceAfter: 2 };
const committed = (replay?: Replay): ExecutionEntry => entryEditorOutcome(entryExecuting(entryFromGrant({ grant: grantWith(replay), decision: "execute_explicit" }, refOf)), { ok: true, status: "committed", receipt, settled: "settled", validations: { drc: { ran: true, violations: 0 } }, undoEligible: true, presetId: "jlcpcb-2l" });
const rows = (entry: ExecutionEntry): string[] => entryToLogMessage(entry).entries.map((row) => row.text);

describe("B18-D review — the live pre-check's reason survives", () => {
  it("the entry names the pre-check's reason, and a later server retirement keeps it", () => {
    const issued = entryFromGrant({ grant: grantWith(), decision: "execute_explicit" }, refOf);
    const refused = entryEditorOutcome(issued, { ok: false, code: "precheck-refused", changed: false, message: "The PCB editor is not synchronized with the server." });
    expect(refused.state).toBe("not_made");
    expect(refused.failure?.headline).toBe("Not made: The PCB editor is not synchronized with the server. Nothing was changed.");
    expect(rows(refused)).toContain("Not made: The PCB editor is not synchronized with the server. Nothing was changed.");
    const afterServer = entrySettled(refused, { status: "retired", outcome: null, reason: "session_superseded", settlement: null } as never);
    expect(afterServer).toBe(refused); // not "the editing session was replaced"
  });

  it("a committed entry the server calls retired still fails safe to landed, unverified", () => {
    expect(entrySettled(committed(), { status: "retired", outcome: null, reason: "revision_drift", settlement: null } as never).state).toBe("landed_unverified");
  });
});

describe("B18-D review — the committed line and the undo hint stay true", () => {
  it("no 'undoable' claim; the hint is conditional", () => {
    const text = rows(committed());
    expect(text.filter((line) => /undoable/.test(line))).toEqual([]);
    expect(text.filter((line) => /^AI change committed by your editor \(one canonical transaction\)/.test(line))).toHaveLength(1);
    expect(text).toContain("Undo: while it is the latest change — “Undo this change” here, the editor's Undo (one step), or say “Undo that.”");
  });

  it("an AI undo's hint says Undo re-applies the change; an AI redo's says it removes it again", () => {
    expect(rows(committed({ direction: "undo", referencedTransactionId: "tx:0", referencedGrantId: "xg-0" }))).toContain("Undo: while it is the latest change — “Undo this change” here or the editor's Undo (one step) re-applies the change; or say “Redo.”");
    expect(rows(committed({ direction: "redo", referencedTransactionId: "tx:0", referencedGrantId: "xg-0" }))).toContain("Undo: while it is the latest change — “Undo this change” here or the editor's Undo (one step) removes the change again; or say “Undo that.”");
  });
});
