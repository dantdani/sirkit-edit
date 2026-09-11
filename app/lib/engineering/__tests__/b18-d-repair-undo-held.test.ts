/**
 * [B18-D review] The repair panel never reports an undo the editor's history refused. `undoRepairTransaction` checked only
 * that the repair was the newest applied entry, then called `history.undo()` and reported success — but while an AI change
 * is being made the canonical session holds history steps (I7), so that undo did nothing and the panel still said "PCB repair
 * undone". It now refuses when the history cannot undo, and checks that the undo really happened. Proven on the REAL
 * canonical session and its hold.
 */
import { describe, expect, it, vi } from "vitest";
import { mmToNm } from "../../pcb/units";
import type { PcbHistory } from "../../pcb/history";
import { undoRepairTransaction } from "../../pcb/repair/transaction";
import { buildExecutionOperations } from "../execution-operations";
import { composition } from "./b18c-harness";

describe("B18-D review — undoing a repair while the history is held", () => {
  it("the real session's hold: refused with a reason and nothing undone; after the hold the same undo works", async () => {
    const c = await composition("execute_explicit_tier1");
    const r4Of = () => c.history.committedPresent.footprints.find((footprint) => footprint.ref === "R4")!;
    const r4 = r4Of();
    const built = buildExecutionOperations(c.history.committedPresent, { family: "pcb.move-footprint", moves: [{ footprintId: r4.id, x: r4.at.x + mmToNm(1), y: r4.at.y }] });
    if (!built.ok) throw new Error(built.message);
    expect((await c.session.commit({ commandId: "pcb.move-footprint", label: "repair-like move", buildOperations: () => built.operations })).ok).toBe(true);
    const transactionId = [...c.history.entries].reverse().find((entry) => entry.state === "applied")!.metadata.transactionId!;
    const moved = r4Of().at.x;
    expect(moved).toBe(r4.at.x + mmToNm(1));

    const release = c.session.holdHistorySteps("an AI change is being made");
    const refused = undoRepairTransaction(c.history, transactionId);
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/refused the undo right now/);
    expect(r4Of().at.x).toBe(moved); // nothing was undone, and nothing claims it was
    release();

    expect(undoRepairTransaction(c.history, transactionId)).toEqual({ ok: true });
    await c.session.whenIdle();
    expect(r4Of().at.x).toBe(r4.at.x);
  });

  it("an undo that silently changes nothing is reported as not done", () => {
    const undo = vi.fn();
    const history = { canUndo: true, undo, entries: [{ state: "applied", metadata: { transactionId: "repair-1" } }] } as unknown as PcbHistory;
    expect(undoRepairTransaction(history, "repair-1")).toEqual({ ok: false, error: "The editor did not undo the repair; nothing was undone." });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("the hold refuses a redo too: canRedo reads false and nothing is redone; after it the redo works", async () => {
    const c = await composition("execute_explicit_tier1");
    const r4Of = () => c.history.committedPresent.footprints.find((footprint) => footprint.ref === "R4")!;
    const r4 = r4Of();
    const built = buildExecutionOperations(c.history.committedPresent, { family: "pcb.move-footprint", moves: [{ footprintId: r4.id, x: r4.at.x + mmToNm(1), y: r4.at.y }] });
    if (!built.ok) throw new Error(built.message);
    expect((await c.session.commit({ commandId: "pcb.move-footprint", label: "move", buildOperations: () => built.operations })).ok).toBe(true);
    c.history.undo();
    await c.session.whenIdle();
    expect(r4Of().at.x).toBe(r4.at.x);
    expect(c.history.canRedo).toBe(true);
    const release = c.session.holdHistorySteps("an AI change is being made");
    expect(c.history.canRedo).toBe(false);
    c.history.redo();
    expect(r4Of().at.x).toBe(r4.at.x); // refused: nothing redone
    release();
    expect(c.history.canRedo).toBe(true);
    c.history.redo();
    await c.session.whenIdle();
    expect(r4Of().at.x).toBe(r4.at.x + mmToNm(1));
  });
});
