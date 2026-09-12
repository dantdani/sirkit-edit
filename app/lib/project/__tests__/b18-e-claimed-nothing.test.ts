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

  it("says nothing about runs that made no claim, that are still running, or whose change really happened", () => {
    expect(run([answer("R3 is at (52.000, 47.480) mm."), { type: "run_completed" }]).label, "a plain answer is not labelled").toBeNull();
    expect(run([claim, refused("unknown_tool"), answer("the tool answered unknown_tool.")]).label, "not before the run ends").toBeNull();
    const received = runViewGrantReceived([claim, { type: "tool_finished", title: "Move footprint", tier: 1, ok: true, status: "execution_grant_issued" }, { type: "execution_settled", status: "settled", outcome: "committed" }, answer("R3 moved 2 mm."), { type: "run_completed" }].reduce(reduceRunView, initialRunView()));
    expect(projectRunView(received).label, "a change that really happened is not called nothing").toBeNull();
  });
});
