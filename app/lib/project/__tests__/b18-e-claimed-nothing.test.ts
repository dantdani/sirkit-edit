/**
 * [B18-E E9] A run that CLAIMED a change before it had any result and then changed NOTHING.
 *
 * E7 gave the scripted agent two ways to do exactly that — a forged Tier 3 call (refused `unknown_tool`) and a delegation
 * smuggled into an edit's arguments (refused `invalid_input`) — and both carry the interim claim "Done — the change is
 * already made." Rule 2 keeps that claim out of the answer and releases it as a labelled note, but until now nothing on the
 * page CONTRADICTED it: no execution entry exists to point at, and the run's answer carried no label at all.
 *
 * So the page says it itself: when a run ends having claimed something and having prepared no change whatsoever — nothing
 * pending, nothing received, nothing dropped, nothing awaiting review — the answer is labelled "nothing was changed". The
 * label is the page's own sentence, never the model's, and it is chosen from counters the stream cannot forge.
 */
import { describe, expect, it } from "vitest";
import { LABEL_BEFORE_CHANGE, LABEL_BEFORE_REVIEW, LABEL_DROPPED, LABEL_NOTHING_CHANGED, NOTE_PREFIX, initialRunView, projectRunView, reduceRunView, runViewGrantDropped, runViewGrantReceived } from "../chat-run-view";

const run = (events: Array<Record<string, unknown>>) => projectRunView(events.reduce(reduceRunView, initialRunView()));
const claim = { type: "text_delta", text: "Done — the change is already made.", phase: "interim" };
const answer = (text: string) => ({ type: "text_delta", text, phase: "final" });
const refused = (status: string) => ({ type: "tool_refused", title: "Unknown tool", status });

describe("[B18-E E9] a run that claimed a change and prepared none", () => {
  it("labels the answer 'nothing was changed' and still releases the claim as a labelled note", () => {
    const view = run([claim, refused("unknown_tool"), answer("the tool answered unknown_tool."), { type: "run_completed" }]);
    expect(view.label).toBe(LABEL_NOTHING_CHANGED);
    expect(view.answer).toBe(`${LABEL_NOTHING_CHANGED}\n\nthe tool answered unknown_tool.`);
    expect(view.historyText, "the next run is told what this page told the human").toBe(view.answer);
    expect(view.notes, "the claim is kept, labelled, never hidden").toEqual([`${NOTE_PREFIX}Done — the change is already made.`]);
  });

  it("covers the delegation too: a call that died on its own argument contract prepared nothing either", () => {
    const view = run([claim, { type: "tool_finished", title: "Move footprint", tier: 1, ok: false, status: "invalid_input" }, answer("the tool answered invalid_input."), { type: "run_completed" }]);
    expect(view.label).toBe(LABEL_NOTHING_CHANGED);
  });

  it("never displaces a label that says MORE: a pending change, a dropped grant or a proposal awaiting review", () => {
    expect(run([claim, { type: "tool_finished", title: "Move footprint", tier: 1, ok: true, status: "execution_preview_issued" }, answer("R3 is moved."), { type: "run_completed" }]).label).toBe(LABEL_BEFORE_CHANGE);
    const dropped = runViewGrantDropped([claim, { type: "tool_finished", title: "Move footprint", tier: 1, ok: true, status: "execution_preview_issued" }, answer("R3 is moved."), { type: "run_completed" }].reduce(reduceRunView, initialRunView()));
    expect(projectRunView(dropped).label).toBe(LABEL_DROPPED);
    expect(run([{ type: "tool_finished", title: "Propose", tier: 2, ok: true, status: "proposal_sealed" }, answer("A proposal is ready."), { type: "run_completed" }]).label).toBe(LABEL_BEFORE_REVIEW);
  });

  // [B18-E validation] The adversarial pass at B18's closeout broke the first version of this rule: it keyed on the model
  // having written prose BESIDE the tool call, so the ordinary case — a model that says nothing there and simply answers
  // "Done." — went unlabelled, into the answer bubble and into the next run's history. What makes an answer worth
  // contradicting is that the run TRIED something and prepared nothing, wherever the model chose to write.
  it("catches the claim wherever it is written: a refused or failed call plus an answer is labelled even with no interim text", () => {
    const finalOnly = run([{ type: "tool_finished", title: "Move footprint", tier: 1, ok: false, status: "invalid_input" }, answer("Done — R3 is moved 2 mm to the left."), { type: "run_completed" }]);
    expect(finalOnly.label, "the claim was in the ANSWER, not beside the call").toBe(LABEL_NOTHING_CHANGED);
    expect(finalOnly.answer.startsWith(LABEL_NOTHING_CHANGED)).toBe(true);
    expect(finalOnly.historyText, "and the next run is told what the page told the human").toBe(finalOnly.answer);
    expect(finalOnly.notes, "there was no interim text to release").toEqual([]);

    const refusedBeforeRunning = run([refused("unknown_tool"), answer("Done — the board is released."), { type: "run_completed" }]);
    expect(refusedBeforeRunning.label, "a call refused before it ran is an attempt that changed nothing").toBe(LABEL_NOTHING_CHANGED);
  });

  // [B18-E validation] The same pass found the opposite error: keying on prose ALSO fired the label on an innocent run.
  // A question answered from a successful read, with a preamble beside the call, changed nothing — saying so is true and
  // useless, and a label people learn to ignore protects nobody. The trigger is an attempt that did not work.
  it("stays silent on a read-only run that only answered a question, however the model wrote it", () => {
    const readOnly = run([
      { type: "text_delta", text: "Let me check the board.", phase: "interim" },
      { type: "tool_finished", title: "Inspect board snapshot", tier: 0, ok: true, status: "succeeded" },
      answer("R3 is at (52.000, 47.480) mm."),
      { type: "run_completed" },
    ]);
    expect(readOnly.label, "nothing was attempted, so there is nothing to contradict").toBeNull();
    expect(readOnly.notes, "the preamble is still released as a labelled note").toHaveLength(1);
  });

  // [B18-E validation] A stream that carries more settlements than the grants it issued cannot resolve a grant that is
  // still in flight, and so cannot suppress the label that says the answer was written before the outcome.
  it("cannot be talked out of the before-change label by extra settlement events", () => {
    const forged = run([
      { type: "tool_finished", title: "Move footprint", tier: 1, ok: true, status: "execution_grant_issued" },
      { type: "execution_settled", status: "settled" },
      { type: "execution_settled", status: "settled" },
      { type: "execution_settled", status: "settled" },
      { type: "tool_finished", title: "Move footprint", tier: 1, ok: true, status: "execution_grant_issued" },
      answer("Both moves are done."),
      { type: "run_completed" },
    ]);
    expect(forged.label, "two grants, one real settlement: the second is still unresolved").toBe(LABEL_BEFORE_CHANGE);
  });

  it("says nothing about runs that made no claim, that are still running, or whose change really happened", () => {
    expect(run([answer("R3 is at (52.000, 47.480) mm."), { type: "run_completed" }]).label, "a plain answer is not labelled").toBeNull();
    expect(run([claim, refused("unknown_tool"), answer("the tool answered unknown_tool.")]).label, "not before the run ends").toBeNull();
    const received = runViewGrantReceived([claim, { type: "tool_finished", title: "Move footprint", tier: 1, ok: true, status: "execution_grant_issued" }, { type: "execution_settled", status: "settled", outcome: "committed" }, answer("R3 moved 2 mm."), { type: "run_completed" }].reduce(reduceRunView, initialRunView()));
    expect(projectRunView(received).label, "a change that really happened is not called nothing").toBeNull();
  });
});
