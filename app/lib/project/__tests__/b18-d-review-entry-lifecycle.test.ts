/**
 * [B18-D review] The chat entry and run view after the adversarial review:
 *  - a confirmed preview refused for a transient reason (nothing changed; its card stays for a retry) leaves "executing":
 *    the entry awaits confirmation again, says the attempt was not made, and no longer pauses other entries' Undo;
 *  - a terminal entry is never reopened by such a refusal;
 *  - a run stopped before its terminal event still releases its interim text as notes, never into the answer or history.
 */
import { describe, expect, it } from "vitest";
import type { PublicExecutionGrant } from "../../engineering/execution-grant";
import { isStoredChatMessage } from "@/lib/persistence";
import { NOTE_PREFIX, entryAttemptRefused, entryCancelled, entryExecuting, entryFromGrant, entryStateOfLogMessage, entryToLogMessage, initialRunView, markGrantLineDropped, projectRunView, reduceRunView } from "../chat-run-view";
import { describeOperation } from "../execution-display";

const grant = {
  grantId: `xg-${"b".repeat(32)}`,
  binding: {
    operation: { family: "pcb.move-footprint", tier: 1, decision: "preview_then_confirm", autonomy: { mode: "proposal_only", revision: 1 } },
    targets: { resolvedFrom: "named", objectIds: ["fp-r3"], netIds: [], kinds: ["footprint"] },
    proposal: { operations: [{ kind: "move_footprint", footprintId: "fp-r3", at: { x: 52_000_000, y: 47_480_000 } }], preview: { before: "R3 at (50.000, 47.480) mm", after: "R3 at (52.000, 47.480) mm", warnings: [] } },
    instruction: { excerpt: "Move R3 2 mm to the right.", explicit: { proven: false, grammarId: "pcb.move-footprint", grammarVersion: "1.4.0", coverage: "unproven", derivedOperationsDigest: null } },
  },
} as unknown as PublicExecutionGrant;
const refOf = (id: string) => (id === "fp-r3" ? "R3" : null);

describe("B18-D review — a transiently refused confirmed preview leaves \"executing\"", () => {
  it("the entry awaits confirmation again and says the last attempt changed nothing", () => {
    const executing = entryExecuting(entryFromGrant({ grant, decision: "preview_then_confirm" }, refOf));
    expect(executing.state).toBe("executing");
    const refused = entryAttemptRefused(executing, { code: "already-in-flight", message: "Another AI change is still being made." });
    expect(refused.state).toBe("awaiting_confirmation");
    const message = entryToLogMessage(refused);
    expect(entryStateOfLogMessage(message)).toBe("awaiting_confirmation");
    const attempt = message.entries.filter((row) => row.text.startsWith("Last attempt not made:"));
    expect(attempt).toHaveLength(1);
    expect(attempt[0]).toMatchObject({ text: "Last attempt not made: Another AI change is still being made. Nothing changed — retry or cancel on the card.", status: "error" });
    expect(message.entries.filter((row) => /Change ready for your confirmation in the PCB editor/.test(row.text))).toHaveLength(1);
    expect(message.entries.some((row) => /Executing in the PCB editor/.test(row.text))).toBe(false);
    expect(isStoredChatMessage(message)).toBe(true);
    // a retry goes back to executing; nothing claims a change was made
    expect(entryExecuting(refused).state).toBe("executing");
  });

  it("a terminal entry is never reopened by a transient refusal", () => {
    const cancelled = entryCancelled(entryFromGrant({ grant, decision: "preview_then_confirm" }, refOf));
    expect(entryAttemptRefused(cancelled, { code: "execution-failed", message: "x" })).toBe(cancelled);
  });
});

describe("B18-D review — a stopped run's interim text is still released as notes", () => {
  it("a synthetic stop terminal releases the interim notes; the answer carries none of them", () => {
    let view = reduceRunView(initialRunView(), { type: "text_delta", text: "(interim) Done — the change is already made.", phase: "interim" });
    expect(projectRunView(view).notes).toEqual([]); // no terminal yet: nothing released
    view = reduceRunView(view, { type: "run_failed", reason: "stopped", message: "Stopped by you." });
    const projected = projectRunView(view);
    expect(projected.notes).toEqual([`${NOTE_PREFIX}(interim) Done — the change is already made.`]);
    expect(projected.answer).toBe("");
    expect(projected.historyText).not.toContain("(interim)");
  });
});

describe("B18-D review — the Operations list shows every field an update can change", () => {
  it("a silkscreen text and a dimension are described with every editable field", () => {
    const silk = describeOperation({ kind: "update_silk", silkId: "silk-1", replace: { kind: "text", id: "silk-1", layer: "silkTop", position: { x: 10_000_000, y: 5_000_000 }, text: "REV B", heightNm: 1_000_000, strokeWidthNm: 150_000, rotationDeg: 90, mirror: false, anchor: "center" } });
    for (const part of ["REV B", "1.000 mm high", "stroke 0.150 mm", "rotation 90°", "not mirrored", "anchored center"]) expect(silk, part).toContain(part);
    const dimension = describeOperation({ kind: "update_dimension", dimensionId: "dim-1", replace: { id: "dim-1", kind: "horizontal", a: { x: 0, y: 0 }, b: { x: 20_000_000, y: 0 }, offsetNm: -2_000_000, layer: "fabTop", unit: "mm", precision: 2, textHeightNm: 800_000, strokeWidthNm: 100_000 } });
    for (const part of ["horizontal dimension from", "offset -2.000 mm", "on fabTop", "in mm to 2 decimals", "text 0.800 mm", "stroke 0.100 mm"]) expect(dimension, part).toContain(part);
  });
});

describe("B18-D review — a grant this page dropped is never reported as issued", () => {
  it("the run log's latest execution tool line is rewritten; every other line stays", () => {
    const rows = [
      { id: "a", text: "Running Sirkit tool: T1 · Add, edit or remove silkscreen text", status: "running" as const },
      { id: "b", text: "T1 · Add, edit or remove silkscreen text — change prepared — awaiting your confirmation", status: "done" as const },
      { id: "c", text: "Assistant note", status: "done" as const },
    ];
    const marked = markGrantLineDropped(rows);
    expect(marked[1]).toEqual({ id: "b", text: "T1 · Add, edit or remove silkscreen text — dropped by this page — it failed the integrity checks; nothing was changed", status: "error" });
    expect(marked[0]).toBe(rows[0]);
    expect(marked[2]).toBe(rows[2]);
    expect(rows[1]!.status).toBe("done"); // the input is not mutated
    const none = [{ id: "x", text: "T0 · Inspect schematic — done", status: "done" as const }];
    expect(markGrantLineDropped(none)).toEqual(none);
  });
});
