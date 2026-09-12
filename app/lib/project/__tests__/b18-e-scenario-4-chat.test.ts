/**
 * [B18-E E15] What the chat says on scenario 4's path — the sentences a person actually reads when a component
 * replacement is proposed, applied, refused or discarded.
 *
 * B14 built the sealed artifact, the review dialog and the apply, and proved all three deeply. What no test asserted was
 * a single sentence of the chat: the "proposal ready" line, the applied line, and — the defect — a REFUSED apply, which
 * produced a transient toast and nothing else. The run log went on saying a proposal awaited review, and never said the
 * attempt had failed and changed nothing. A cancel was silent in the chat for the same reason.
 *
 * The sentences are now a tested pure function the page calls, so they can be read here and cannot drift unnoticed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LABEL_BEFORE_REVIEW, initialRunView, projectRunView, reduceRunView, replacementChatLines, toolLineLabel } from "../chat-run-view";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "../../engineering/agent-exposure";
import { GRANTED_EXECUTION_TOOL_IDS, NEVER_GRANTED_COMMAND_IDS } from "../../engineering/granted-execution-families";

const REPLACEMENT_TOOL = "sirkit.schematic.propose-component-replacement";

describe("[B18-E E15] the chat's sentences for a component replacement", () => {
  const ready = replacementChatLines.ready({ partId: "TLC555CDR", manufacturer: "Texas Instruments", preservedConnections: 8, droppedConnections: 0 });

  it("the ready line names the part, WHERE it came from, what happens to the connections, and that nothing has changed", () => {
    expect(ready).toContain("TLC555CDR");
    expect(ready).toContain("Texas Instruments");
    expect(ready, "the authority chose the part — the model only named the component").toContain("the part this project's component authority records for this component");
    expect(ready).toContain("8 connected pins keep their connections");
    expect(ready).toContain("none are dropped");
    expect(ready).toContain("Nothing has been changed; it awaits your explicit review.");
    // It never borrows the user's framing: the authority record carries no power fact, so no sentence may imply one.
    expect(ready.toLowerCase()).not.toContain("lower-power");
    expect(ready.toLowerCase()).not.toContain("applied");
  });

  it("it counts honestly: one pin reads as one, and a dropped connection would be stated rather than omitted", () => {
    expect(replacementChatLines.ready({ partId: "P", preservedConnections: 1, droppedConnections: 0 })).toContain("1 connected pin keeps its connection");
    expect(replacementChatLines.ready({ partId: "P", preservedConnections: 0, droppedConnections: 2 })).toContain("2 would be dropped");
    expect(replacementChatLines.ready({ partId: "P", preservedConnections: 0, droppedConnections: 0 }), "no manufacturer, no empty parentheses").not.toContain("()");
  });

  it("the applied line points at something undoable, and an already-applied apply says so instead of claiming a second one", () => {
    const applied = replacementChatLines.applied({ alreadyApplied: false, sourcePartId: "NE555DR", targetPartId: "TLC555CDR", transactionId: "tx-0123456789abcdef" });
    expect(applied).toBe("Replacement applied — NE555DR → TLC555CDR, canonical transaction tx-012345678… (verified, undoable).");
    expect(replacementChatLines.applied({ alreadyApplied: true, sourcePartId: "NE555DR", targetPartId: "TLC555CDR", transactionId: "tx-0123456789abcdef" })).toContain("was already applied");
  });

  it("a REFUSED apply says so, in the chat, with the reason and that nothing was changed — it used to say nothing at all", () => {
    const refused = replacementChatLines.refused("The proposal has expired; request a fresh one.");
    expect(refused).toBe("Replacement NOT applied: The proposal has expired; request a fresh one. Nothing was changed.");
    expect(replacementChatLines.refused(undefined), "a missing reason still says the outcome").toBe("Replacement NOT applied: the editor refused it. Nothing was changed.");
    expect(replacementChatLines.refused("x".repeat(5_000)).length, "the line stays a line").toBeLessThan(400);
    // [E16] measured in the browser: the editor's own refusals already end with this sentence. Saying it twice reads as a
    // stutter — "Nothing was changed. Nothing was changed." — so it is said once, whoever says it.
    expect(replacementChatLines.refused("Fresh server authority no longer matches the reviewed proposal; regenerate it. Nothing was changed."))
      .toBe("Replacement NOT applied: Fresh server authority no longer matches the reviewed proposal; regenerate it. Nothing was changed.");
    expect(replacementChatLines.discarded()).toBe("Replacement proposal discarded — nothing was changed.");
  });

  it("the page uses these sentences on all four outcomes — including the two it used to keep to itself", () => {
    const page = readFileSync("app/page.tsx", "utf8");
    for (const call of ["replacementChatLines.ready({", "replacementChatLines.applied({", "replacementChatLines.refused(outcome.message)", "replacementChatLines.discarded()"]) {
      expect(page.includes(call), call).toBe(true);
    }
    // The refusal and the cancel reach the CHAT, not only a toast that disappears.
    expect(page).toContain('content: replacementChatLines.refused(outcome.message)');
    expect(page).toContain('content: replacementChatLines.discarded()');
  });
});

describe("[B18-E E15] scenario 4 under the chat's own rules", () => {
  it("Rule 2 covers a sealed replacement: the answer is labelled as written before anything was applied", () => {
    const events: Array<Record<string, unknown>> = [
      { type: "text_delta", text: "Replacing it now.", phase: "interim" },
      { type: "tool_finished", title: "Propose component replacement", tier: 2, ok: true, status: "proposal_sealed" },
      { type: "text_delta", text: "A replacement proposal is ready for your review.", phase: "final" },
      { type: "run_completed" },
    ];
    const view = projectRunView(events.reduce(reduceRunView, initialRunView()));
    expect(view.label).toBe(LABEL_BEFORE_REVIEW);
    expect(view.answer.startsWith(LABEL_BEFORE_REVIEW)).toBe(true);
    expect(view.notes, "the claim made before the result is kept, labelled, and never becomes the answer").toHaveLength(1);
    expect(toolLineLabel(events[1]!)).toBe("T2 · Propose component replacement — proposal sealed — awaiting your review");
  });

  it("the replacement is Tier 2 by construction, BY NAME: exposed to propose, never grantable, and its command can never be granted", () => {
    const descriptor = sirkitToolRegistry().list().find((item) => item.toolId === REPLACEMENT_TOOL)!;
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS).toContain(REPLACEMENT_TOOL);
    expect(descriptor).toMatchObject({ operationClass: "propose", sideEffects: "proposal-artifact", owningCommandId: "schematic.replace-component-propose" });
    expect(GRANTED_EXECUTION_TOOL_IDS, "no via of execution: a replacement is never a one-shot grant").not.toContain(REPLACEMENT_TOOL);
    expect(descriptor.executionMode).toBeUndefined();
    // And the command that actually performs it is on the never-granted list, so no rename can smuggle it into a grant.
    expect(NEVER_GRANTED_COMMAND_IDS).toContain("schematic.replace-component");
  });
});
