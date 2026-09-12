/**
 * [B18-D review 2] The second adversarial review's confirmed findings (I11–I12), at the reducer level:
 *  - a confirmed preview's "Executing" line never says the assistant waits (no run waits for a preview); an explicit one does;
 *  - the stored undo hint never names the chat's own button (a reloaded record has none);
 *  - a run whose only grants this page dropped is labelled as such — never "the entry above" when there is no entry — a drop
 *    never removes a label, and no event in the run's stream can change what the page decided;
 *  - after the chat's Undo, the reason follows where the change is: on the editor's redo stack, cleared by a later change,
 *    redone, under later changes, on top again, or unknown after the history was replaced.
 */
import { describe, expect, it } from "vitest";
import type { PublicExecutionGrant } from "../../engineering/execution-grant";
import { refusalKeepsPreviewCard, type GrantedExecutionRefusalCode } from "../../engineering/granted-executions";
import { LABEL_BEFORE_CHANGE, LABEL_DROPPED, editRouteProvenanceNote, entryEditorOutcome, entryExecuting, entryFromGrant, entryToLogMessage, entryUndoAvailability, entryUndoResult, initialRunView, projectRunView, reduceRunView, runViewGrantDropped, runViewGrantReceived, type TimelineStep } from "../chat-run-view";
import { retirementSentence } from "../execution-display";

const grant = (decision: "execute_explicit" | "preview_then_confirm"): PublicExecutionGrant => ({
  grantId: `xg-${"e".repeat(32)}`,
  binding: {
    operation: { family: "pcb.move-footprint", tier: 1, decision, autonomy: { mode: decision === "execute_explicit" ? "execute_explicit_tier1" : "proposal_only", revision: 1 } },
    targets: { resolvedFrom: "named", objectIds: ["fp-r3"], netIds: [], kinds: ["footprint"] },
    proposal: { operations: [{ kind: "move_footprint", footprintId: "fp-r3", at: { x: 52_000_000, y: 47_480_000 } }], preview: { before: "R3 at (50.000, 47.480) mm", after: "R3 at (52.000, 47.480) mm", warnings: [] } },
    instruction: { excerpt: "Move R3 2 mm to the right.", explicit: { proven: decision === "execute_explicit", grammarId: "pcb.move-footprint", grammarVersion: "1.4.0", coverage: decision === "execute_explicit" ? "exact" : "unproven", derivedOperationsDigest: null } },
  },
}) as unknown as PublicExecutionGrant;
const refOf = (id: string) => (id === "fp-r3" ? "R3" : null);
const receipt = { transactionId: "tx:pcb.move-footprint:12", pcbRevisionBefore: "pcb2-cccccccccccccccccccc", pcbRevisionAfter: "pcb2-dddddddddddddddddddd", headSequenceAfter: 7 };
const committedEntry = () => entryEditorOutcome(entryExecuting(entryFromGrant({ grant: grant("execute_explicit"), decision: "execute_explicit" }, refOf)), { ok: true, status: "committed", receipt, settled: "settled", undoEligible: true });

describe("B18-D review 2 — a confirmed preview is never said to be waited on", () => {
  it("only an explicit grant's executing line names the assistant's wait", () => {
    const preview = entryExecuting(entryFromGrant({ grant: grant("preview_then_confirm"), decision: "preview_then_confirm" }, refOf));
    const explicit = entryExecuting(entryFromGrant({ grant: grant("execute_explicit"), decision: "execute_explicit" }, refOf));
    expect(preview.state).toBe("executing");
    const previewLine = entryToLogMessage(preview).entries[0]!.text;
    expect(previewLine).toBe("Executing in the PCB editor — R3 at (52.000, 47.480) mm (one canonical transaction) — awaiting the editor's result");
    expect(previewLine).not.toMatch(/the assistant waits/);
    expect(entryToLogMessage(explicit).entries[0]!.text).toMatch(/— awaiting the editor's settlement \(the assistant waits up to 60 s\)$/);
  });
});

describe("B18-D review 2 — the stored undo hint never names the chat's own button", () => {
  it("for a change, an AI undo and an AI redo", () => {
    for (const replay of [null, "undo", "redo"] as const) {
      const rows = entryToLogMessage({ ...committedEntry(), replay }).entries;
      expect(rows.find((row) => row.id.endsWith(":undo"))!.text).toMatch(/^Undo: while it is the latest change — the editor's Undo \(one step\)/);
      expect(rows.some((row) => /Undo this change/.test(row.text)), replay ?? "change").toBe(false);
    }
  });
});

describe("B18-D review 2 — a grant this page dropped", () => {
  const issued = { type: "tool_finished", ok: true, status: "execution_preview_issued" };
  const final = { type: "text_delta", phase: "final", text: "(fixture agent) the tool answered execution_preview_issued." };

  it("a run whose only grant was dropped says so; once an entry exists, the entry is named", () => {
    const dropped = reduceRunView(runViewGrantDropped(reduceRunView(initialRunView(), issued)), final);
    expect(projectRunView(dropped).label).toBe(LABEL_DROPPED);
    expect(projectRunView(dropped).answer.startsWith(`${LABEL_DROPPED}\n\n`)).toBe(true);
    expect(LABEL_DROPPED).not.toMatch(/entry above/);
    const received = reduceRunView(runViewGrantReceived(reduceRunView(initialRunView(), issued)), final);
    expect(projectRunView(received).label).toBe(LABEL_BEFORE_CHANGE);
    const both = reduceRunView(runViewGrantDropped(runViewGrantReceived(reduceRunView(reduceRunView(initialRunView(), issued), issued))), final);
    expect(projectRunView(both).label).toBe(LABEL_BEFORE_CHANGE);
  });

  it("a drop never removes a label, and nothing in the run's stream can change what the page decided", () => {
    // a dropped event with no issued tool line of its own leaves the received change's label in place
    const other = reduceRunView(runViewGrantReceived(reduceRunView(initialRunView(), issued)), final);
    expect(projectRunView(runViewGrantDropped(other)).label).toBe(LABEL_BEFORE_CHANGE);
    let state = reduceRunView(initialRunView(), issued);
    for (const type of ["execution_grant_dropped", "execution_grant_received", "grant_dropped", "grant_received", "execution_grant_ready"]) state = reduceRunView(state, { type });
    expect(state).toMatchObject({ receivedExecutions: 0, droppedExecutions: 0, pendingExecutions: 1 });
  });
});

describe("B18-D review 2 — after the chat's Undo, the reason follows the change", () => {
  const undoneAt = 10;
  const undone = entryUndoResult(committedEntry(), { ok: true, afterSeq: undoneAt });
  const reason = (...kinds: Array<TimelineStep["kind"] | [TimelineStep["kind"], TimelineStep["store"]]>): string | null | undefined => {
    const steps: TimelineStep[] = [{ seq: undoneAt, kind: "commit", store: "pcb", ref: { transactionId: receipt.transactionId } }];
    kinds.forEach((kind, index) => {
      const [k, store] = Array.isArray(kind) ? kind : [kind, "pcb" as const];
      steps.push({ seq: undoneAt + 1 + index, kind: k, store, ref: { transactionId: k === "redo" ? receipt.transactionId : "tx-other" } });
    });
    return entryUndoAvailability(undone, steps.at(-1), false, steps)?.reason;
  };

  it("on the editor's redo stack: its Redo brings it back (after re-applying any earlier steps undone since)", () => {
    expect(reason()).toBe("Already undone — the editor's Redo brings it back."); // the chat's own undo not yet recorded
    expect(reason("undo")).toBe("Already undone — the editor's Redo brings it back.");
    expect(reason("undo", "undo")).toBe("Already undone — the editor's Redo brings it back after re-applying 1 earlier step.");
    expect(reason("undo", "undo", "undo")).toBe("Already undone — the editor's Redo brings it back after re-applying 2 earlier steps.");
    expect(reason("undo", "undo", "redo")).toBe("Already undone — the editor's Redo brings it back.");
    expect(reason("undo", ["commit", "schematic"])).toBe("Already undone — the editor's Redo brings it back."); // another store's history
  });

  it("a later change cleared the editor's Redo: never 'Redo brings it back'", () => {
    expect(reason("undo", "commit")).toBe("Already undone — a later change cleared the editor's Redo; ask again, or use the revision history.");
    expect(reason("undo", "undo", "commit")).toBe("Already undone — a later change cleared the editor's Redo; ask again, or use the revision history.");
    expect(reason("undo", "commit", "undo")).toBe("Already undone — a later change cleared the editor's Redo; ask again, or use the revision history.");
  });

  it("redone: on top (the editor's Undo reverts it), under later changes (the revision history), or on top again", () => {
    expect(reason("undo", "redo")).toBe("Undone once from here, and the editor's Redo brought it back — use the editor's Undo, or say “Undo that.”");
    expect(reason("undo", "redo", "commit")).toBe("Undone once from here and redone since; later changes are above it — use the revision history.");
    expect(reason("undo", "redo", "commit", "undo")).toBe("Undone once from here and redone since — it is on top again: the editor's Undo reverts it.");
  });

  it("the history was replaced, or the page has no record: it claims nothing", () => {
    expect(reason("undo", "restore")).toBe("Undone once from here — the history was replaced since; the revision history shows where it stands.");
    expect(reason("undo", "hydrate", "redo")).toBe("Undone once from here — the history was replaced since; the revision history shows where it stands.");
    const noSeq = entryUndoResult(committedEntry(), { ok: true });
    expect(entryUndoAvailability(noSeq, undefined, false, [])?.reason).toBe("Undone once from here — the revision history shows where it stands.");
    expect(entryUndoAvailability(undone, undefined, false)?.reason).toBe("Undone once from here — the revision history shows where it stands.");
    expect(entryUndoAvailability(undone, undefined, false)?.eligible).toBe(false); // one-shot (D-A8)
  });
});

describe("B18-D review 2 — the label applies only while the model could not know the outcome", () => {
  it("a durable outcome before the answer (settled with any outcome, or retired) needs no label; an unsettled answer keeps it", () => {
    const issued = { type: "tool_finished", ok: true, status: "execution_grant_issued" };
    const answer = { type: "text_delta", phase: "final", text: "Not made." };
    const run = (settled: Record<string, unknown>) => [issued, { type: "execution_settled", ...settled }, answer].reduce(reduceRunView, runViewGrantReceived(initialRunView()));
    for (const settled of [{ status: "retired", reason: "session_superseded" }, { status: "settled", outcome: "not_committed" }, { status: "settled", outcome: "poisoned" }, { status: "settled", outcome: "committed" }]) {
      expect(projectRunView(run(settled)).label, JSON.stringify(settled)).toBeNull();
    }
    for (const status of ["unsettled", "in_flight"]) expect(projectRunView(run({ status })).label, status).toBe(LABEL_BEFORE_CHANGE);
  });
});

describe("B18-D review 2 — a refused Confirm whose grant was consumed", () => {
  const refusal = (code: GrantedExecutionRefusalCode, extra: { changed?: boolean; grantConsumed?: true } = {}) => ({ ok: false as const, status: "refused" as const, code, message: "m", changed: extra.changed ?? false, serverCode: null, ...(extra.grantConsumed ? { grantConsumed: true as const } : {}) });

  it("keeps the card only for a transient refusal of a grant that was not consumed", () => {
    expect(refusalKeepsPreviewCard(refusal("recovery-required"))).toBe(true);
    expect(refusalKeepsPreviewCard(refusal("execution-failed"))).toBe(true);
    expect(refusalKeepsPreviewCard(refusal("already-in-flight"))).toBe(true);
    expect(refusalKeepsPreviewCard(refusal("recovery-required", { grantConsumed: true }))).toBe(false);
    expect(refusalKeepsPreviewCard(refusal("execution-failed", { grantConsumed: true }))).toBe(false);
    expect(refusalKeepsPreviewCard(refusal("recovery-required", { changed: true }))).toBe(false);
    expect(refusalKeepsPreviewCard(refusal("consume-refused"))).toBe(false);
  });

  it("its entry says it cannot be retried — never 'confirm again' or 'recovery settles it'", () => {
    const executing = entryExecuting(entryFromGrant({ grant: grant("preview_then_confirm"), decision: "preview_then_confirm" }, refOf));
    const settled = entryEditorOutcome(executing, { ok: false, code: "recovery-required", changed: false, message: "The grant was consumed but the durable journal could not record it.", grantConsumed: true });
    expect(settled.state).toBe("not_made");
    expect(settled.failure?.headline).toBe("Not made — the grant was used and settled as not committed, so it cannot be retried. Nothing was changed.");
    expect(entryToLogMessage(settled).entries.map((row) => row.text).join("\n")).not.toMatch(/Change ready for your confirmation|recovery settles it|retry or cancel/);
  });
});

describe("B18-D review 2 — the edit route seals the page's own note; a retirement names what happened", () => {
  it("the sealed note never carries the model's text", () => {
    expect(editRouteProvenanceNote("Changed R1 to 4.7 kΩ.")).not.toContain("Changed R1");
    expect(editRouteProvenanceNote("Changed R1 to 4.7 kΩ.")).toMatch(/run log, labelled as written before the result/);
    expect(editRouteProvenanceNote("  ")).toBe("Prepared by the schematic edit route from your instruction.");
    expect(editRouteProvenanceNote(undefined)).toBe("Prepared by the schematic edit route from your instruction.");
  });

  it("the editor's own refusal before making it has its own sentence", () => {
    expect(retirementSentence("refused_before_execution")).toMatch(/refused it before making it/);
    expect(retirementSentence("refused_before_execution")).not.toMatch(/session was replaced/);
  });
});
