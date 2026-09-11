/**
 * [B18-D I3] The chat's run view (chat-execution-ux.md §2, R2-3 to R2-7) and the execution entry (§1): interim model text
 * never enters the answer, a final answer written before any durable result is labelled, tool lines say what really
 * happened, and one entry per grant follows the grant, the editor's outcome and the server's settlement — failing safe
 * to "landed, unverified" when they disagree.
 */
import { describe, expect, it } from "vitest";
import type { PublicExecutionGrant } from "../../engineering/execution-grant";
import { LABEL_BEFORE_CHANGE, LABEL_BEFORE_REVIEW, NOTE_PREFIX, entryCancelled, entryEditorOutcome, entryExecuting, entryFromGrant, entryRecovery, entrySettled, entrySuperseded, initialRunView, isTerminalEntry, projectRunView, reduceRunView, runViewExecutionCommitted, toolLineLabel } from "../chat-run-view";

const run = (events: Array<Record<string, unknown>>) => projectRunView(events.reduce(reduceRunView, initialRunView()));
const text = (value: string, phase?: "interim" | "final") => ({ type: "text_delta", text: value, ...(phase ? { phase } : {}) });
const finished = (status: string, ok = true) => ({ type: "tool_finished", title: "Move footprint", tier: 1, ok, status });

const grant = (decision: "preview_then_confirm" | "execute_explicit" = "preview_then_confirm") => ({
  grantId: `xg-${"1".repeat(32)}`,
  binding: {
    operation: { family: "pcb.move-footprint", tier: 1, decision, autonomy: { mode: decision === "execute_explicit" ? "execute_explicit_tier1" : "proposal_only", revision: 1 } },
    targets: { resolvedFrom: "named", objectIds: ["fp-r3"], netIds: [], kinds: ["footprint"] },
    proposal: { operations: [{ kind: "move_footprint", footprintId: "fp-r3", at: { x: 52_000_000, y: 47_480_000 } }], preview: { before: "R3 at (50.000, 47.480) mm", after: "R3 at (52.000, 47.480) mm", warnings: [] } },
    instruction: { excerpt: "Move R3 2 mm to the right.", explicit: { proven: decision === "execute_explicit", grammarId: "pcb.move-footprint", grammarVersion: "1.4.0", coverage: decision === "execute_explicit" ? "whole-message" : "unproven", derivedOperationsDigest: null } },
  },
}) as unknown as PublicExecutionGrant;
const receipt = { transactionId: "tx:pcb.move-footprint:1", pcbRevisionBefore: "pcb2-aaa", pcbRevisionAfter: "pcb2-bbb", headSequenceAfter: 2 };
const refOf = (id: string) => (id === "fp-r3" ? "R3" : null);

describe("B18-D I3 — tool lines say what really happened", () => {
  it("only a finished read is 'done'; grants, previews, proposals, candidates and views say what they are", () => {
    expect(toolLineLabel({ title: "Inspect the current selection", tier: 0, ok: true, status: "succeeded" })).toBe("T0 · Inspect the current selection — done");
    expect(toolLineLabel({ title: "Move footprint", tier: 1, ok: true, status: "execution_grant_issued" })).toBe("T1 · Move footprint — grant issued — executing in your editor");
    expect(toolLineLabel({ title: "Move footprint", tier: 1, ok: true, status: "execution_preview_issued" })).toBe("T1 · Move footprint — change prepared — awaiting your confirmation");
    expect(toolLineLabel({ title: "Propose", tier: 2, ok: true, status: "proposal_sealed" })).toBe("T2 · Propose — proposal sealed — awaiting your review");
    expect(toolLineLabel({ title: "Place", tier: 2, ok: true, status: "layout_candidate_ready" })).toBe("T2 · Place — candidate ready — awaiting your review");
    expect(toolLineLabel({ title: "View", tier: 0, ok: true, status: "view_command_dispatched" })).toBe("T0 · View — view request sent");
    expect(toolLineLabel({ title: "Move footprint", tier: 1, ok: false, status: "execution_not_permitted" })).toBe("T1 · Move footprint — refused (execution_not_permitted)");
    expect(toolLineLabel({ title: "X", tier: null, ok: true, status: "mystery" })).toBe("X — finished (mystery)");
    for (const status of ["execution_grant_issued", "execution_preview_issued", "proposal_sealed", "layout_candidate_ready", "view_command_dispatched", "mystery"]) {
      expect(toolLineLabel({ title: "T", tier: 1, ok: true, status }), status).not.toMatch(/succeeded|\bdone\b|\bmade\b/);
    }
  });
});

describe("B18-D I3 — the answer, the notes and the history (Rule 2 on the page)", () => {
  it("interim text never enters the answer; notes are released only when the run ends; a missing phase is quarantined", () => {
    const mid = projectRunView([text("Done, R3 moved.", "interim"), text("sneaky")].reduce(reduceRunView, initialRunView()));
    expect(mid.answer).toBe("");
    expect(mid.notes).toEqual([]); // not before the run ends
    const ended = run([text("Done, R3 moved.", "interim"), text("sneaky"), { type: "run_completed" }]);
    expect(ended.answer).toBe("");
    expect(ended.notes).toEqual([`${NOTE_PREFIX}Done, R3 moved.`, `${NOTE_PREFIX}sneaky`]);
    expect(ended.historyText).toBe("");
  });

  it("a preview run's answer is labelled; an explicit committed run's is not; not-committed, retired and unsettled runs are labelled", () => {
    const preview = run([finished("execution_preview_issued"), text("R3 is moved.", "final"), { type: "run_completed" }]);
    expect(preview.answer).toBe(`${LABEL_BEFORE_CHANGE}\n\nR3 is moved.`);
    expect(preview.historyText).toBe(preview.answer);
    const committed = run([finished("execution_grant_issued"), { type: "execution_settled", status: "settled", outcome: "committed" }, text("R3 moved 2 mm.", "final"), { type: "run_completed" }]);
    expect(committed).toMatchObject({ answer: "R3 moved 2 mm.", label: null });
    for (const settled of [{ status: "settled", outcome: "not-committed" }, { status: "retired", outcome: null }, { status: "unsettled", outcome: null }, { status: "in_flight", outcome: null }]) {
      expect(run([finished("execution_grant_issued"), { type: "execution_settled", ...settled }, text("Done.", "final"), { type: "run_completed" }]).label, JSON.stringify(settled)).toBe(LABEL_BEFORE_CHANGE);
    }
    // a preview the human later confirms: the page folds the editor's committed outcome in
    const confirmed = projectRunView(runViewExecutionCommitted([finished("execution_preview_issued"), text("R3 is moved.", "final")].reduce(reduceRunView, initialRunView())));
    expect(confirmed.label).toBeNull();
  });

  it("a proposal or candidate labels the answer as written before anything was applied; a read-only run is never labelled", () => {
    expect(run([finished("proposal_sealed"), text("Here is the proposal.", "final")]).label).toBe(LABEL_BEFORE_REVIEW);
    expect(run([finished("layout_candidate_ready"), text("Placement candidate ready.", "final")]).label).toBe(LABEL_BEFORE_REVIEW);
    expect(run([finished("succeeded"), text("R3 is at (50, 47.48) mm.", "final")]).label).toBeNull();
    expect(run([finished("execution_preview_issued")]).label).toBeNull(); // no answer text, nothing to label
  });

  it("a failed run shows its failure even after interim text, and the history never carries the notes", () => {
    const failed = run([text("Working on it…", "interim"), { type: "run_failed", message: "The provider timed out." }]);
    expect(failed).toMatchObject({ answer: "", failure: "The provider timed out.", notes: [`${NOTE_PREFIX}Working on it…`] });
    expect(failed.historyText).not.toContain("Working on it");
  });
});

describe("B18-D I3 — one execution entry per grant", () => {
  it("a received grant becomes an entry: what was asked and understood, targets, operations, tier and why a confirmation is (not) required", () => {
    const preview = entryFromGrant({ grant: grant(), decision: "preview_then_confirm", note: null }, refOf);
    expect(preview).toMatchObject({
      state: "awaiting_confirmation", tier: "Tier 1 · reversible edit", asked: "Move R3 2 mm to the right.", understood: "pcb.move-footprint — R3 at (52.000, 47.480) mm",
      targets: ["R3"], nets: "Nets named: none", operations: ["Place R3 at (52.000, 47.480) mm"], confirmation: "Required — this project asks before every AI change (proposal_only, setting revision 1).",
      transaction: null, failure: null, undoEligible: false,
    });
    expect(entryFromGrant({ grant: grant("execute_explicit"), decision: "execute_explicit" }).state).toBe("issued");
  });

  it("the editor's outcome: committed with the transaction, the revisions, the checks and undo; a refusal says nothing changed; a landed-unverified one says it MAY have", () => {
    const entry = entryExecuting(entryFromGrant({ grant: grant(), decision: "preview_then_confirm" }));
    expect(entry.state).toBe("executing");
    const committed = entryEditorOutcome(entry, { ok: true, status: "committed", receipt, settled: "settled", validations: { drc: { ran: true, violations: 7 } }, undoEligible: true, presetId: "jlcpcb-2l" });
    expect(committed).toMatchObject({ state: "committed", transaction: { id: "tx:pcb.move-footprint:1", revisionBefore: "pcb2-aaa", revisionAfter: "pcb2-bbb", headSequenceAfter: 2 }, serverRecord: "settled", checks: "Checks: design rule check (jlcpcb-2l): 7 errors (run by your editor; errors only).", undoEligible: true });
    expect(entryEditorOutcome(entry, { ok: true, status: "committed", receipt, settled: "settle-failed" }).serverRecord).toBe("not yet recorded");
    expect(entryEditorOutcome(entry, { ok: false, code: "stale-revision", changed: false })).toMatchObject({ state: "not_made", failure: { code: "stale-revision", headline: expect.stringMatching(/Nothing was changed/) } });
    expect(entryEditorOutcome(entry, { ok: false, code: "recovery-required", changed: true })).toMatchObject({ state: "landed_unverified", failure: { headline: expect.stringMatching(/MAY have changed/) } });
  });

  it("the server settlement: committed fills the record; not-made, poisoned, retired and unsettled say so; a server 'not made' after the editor's commit fails safe", () => {
    const entry = entryFromGrant({ grant: grant("execute_explicit"), decision: "execute_explicit" });
    const summary = { transactionId: "tx:1", revisionBefore: "pcb2-a", revisionAfter: "pcb2-b", headSequenceAfter: 4, drc: { ran: true, violations: 0 }, undoEligible: true };
    expect(entrySettled(entry, { status: "settled", outcome: "committed", reason: null, settlement: summary })).toMatchObject({ state: "committed", serverRecord: "settled", transaction: { id: "tx:1" }, checks: expect.stringMatching(/0 errors/), undoEligible: true });
    expect(entrySettled(entry, { status: "settled", outcome: "not-committed", reason: null, settlement: null }).state).toBe("not_made");
    expect(entrySettled(entry, { status: "settled", outcome: "poisoned", reason: null, settlement: null }).state).toBe("landed_unverified");
    expect(entrySettled(entry, { status: "retired", outcome: null, reason: "expired", settlement: null })).toMatchObject({ state: "not_made", failure: { headline: "Not made — it expired before it was made. Nothing was changed." } });
    expect(entrySettled(entry, { status: "unsettled", outcome: null, reason: null, settlement: null }).state).toBe("outcome_unknown");
    const committed = entryEditorOutcome(entry, { ok: true, status: "committed", receipt, settled: "settled" });
    expect(entrySettled(committed, { status: "retired", outcome: null, reason: "run_unsettled", settlement: null })).toMatchObject({ state: "landed_unverified", failure: { code: "records-disagree" } });
    expect(entrySettled(committed, { status: "unsettled", outcome: null, reason: null, settlement: null }).state).toBe("committed"); // a terminal state is not reopened by "not yet known"
  });

  it("cancel and supersede never reopen a finished entry; recovery adds its sentence", () => {
    const entry = entryFromGrant({ grant: grant(), decision: "preview_then_confirm" });
    expect(entryCancelled(entry)).toMatchObject({ state: "cancelled", failure: { headline: "Cancelled — nothing was changed." } });
    expect(entrySuperseded(entry).state).toBe("superseded");
    const committed = entryEditorOutcome(entry, { ok: true, status: "committed", receipt, settled: "settled" });
    expect(entryCancelled(committed).state).toBe("committed");
    expect(isTerminalEntry(committed)).toBe(true);
    expect(entryRecovery(entry, "adopted-and-settled").recovery).toMatch(/^Recovered: /);
  });
});
