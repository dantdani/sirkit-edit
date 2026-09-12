/**
 * [B18-D I7] The probe for P2 (chat-execution-ux.md §4, window (c)): a user's Undo that lands while a granted execution
 * waits on the canonical executor. Before the history hold, the wrapped history popped the patch at once and queued its
 * reconcile behind the commit; the commit then took its undo base from the already-undone board, replaced the board with
 * a result computed from the pre-undo base (the user's Undo silently overwritten), cleared the redo stack (the user's
 * Redo lost) and the queued reconcile found the head moved and REBASED the lineage.
 *
 * With the hold, the ritual refuses every history step for as long as it executes: the Undo does nothing and says so
 * (canUndo reads false; the timeline and the editor explain why), the AI change commits as ONE transaction, no rebase
 * happens, and afterwards the history is intact — the first Undo reverses the AI change, the second the human change.
 */
import { describe, expect, it } from "vitest";
import { mmToNm } from "../../pcb/units";
import { buildExecutionOperations } from "../execution-operations";
import { call, composition, movesBy, r3Of, runScenario, type Composed } from "./b18c-harness";

const moveScript = (c: Composed) => (move: string) => [() => ({ toolCalls: [call("c1", move, movesBy(c, 2))] }), () => ({ text: "done" })];
const r4Of = (c: Composed) => c.history.committedPresent.footprints.find((footprint) => footprint.ref === "R4")!;

/** Hold the session's canonical executor on a gate: resolves `entered` when a commit reaches it. */
function gateExecutor(c: Composed): { entered: Promise<void>; release: () => void } {
  const executor = (c.session as unknown as { executor: { execute: (request: unknown) => Promise<unknown> } }).executor;
  const real = executor.execute.bind(executor);
  let release!: () => void;
  let markEntered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  let armed = true;
  executor.execute = async (request: unknown) => {
    if (armed) { armed = false; markEntered(); await gate; }
    return real(request);
  };
  return { entered, release };
}

describe("B18-D I7 — an Undo pressed while a granted execution waits on the executor", () => {
  it("is refused visibly during the execution; the AI change commits once; no rebase; the history is intact afterwards", async () => {
    const c = await composition("execute_explicit_tier1");
    const r4 = r4Of(c);
    const built = buildExecutionOperations(c.history.committedPresent, { family: "pcb.move-footprint", moves: [{ footprintId: r4.id, x: r4.at.x + mmToNm(1), y: r4.at.y }] });
    if (!built.ok) throw new Error(built.message);
    expect((await c.session.commit({ commandId: "pcb.move-footprint", label: "human move", buildOperations: () => built.operations })).ok).toBe(true);
    const r4Moved = r4Of(c).at.x;
    const r3Before = r3Of(c).at.x;
    const eventsBefore = c.session.events.length;

    const gate = gateExecutor(c);
    const running = runScenario(c, moveScript(c));
    await gate.entered; // the granted commit is waiting on the executor
    expect(c.history.canUndo).toBe(false); // the hold: no history step while the AI change executes
    c.history.undo(); // the user's Ctrl+Z
    expect(r4Of(c).at.x).toBe(r4Moved); // refused — nothing popped
    gate.release();
    const run = await running;
    await c.session.whenIdle();

    expect(run.rituals[0], JSON.stringify(run.rituals[0])).toMatchObject({ ok: true, status: "committed" });
    expect(r3Of(c).at.x).toBe(r3Before + mmToNm(2));
    expect(r4Of(c).at.x).toBe(r4Moved); // the human change was never silently overwritten
    expect(c.session.events.slice(eventsBefore).some((event) => event.kind === "reconcile-rebased" || event.kind === "rebased")).toBe(false);
    expect(c.history.canUndo).toBe(true); // the hold is released

    c.history.undo(); // the first Undo reverses the AI change
    await c.session.whenIdle();
    expect(r3Of(c).at.x).toBe(r3Before);
    expect(r4Of(c).at.x).toBe(r4Moved);
    c.history.undo(); // the second reverses the human change
    await c.session.whenIdle();
    expect(r4Of(c).at.x).toBe(r4.at.x);
  }, 30_000);

  it("a ritual that fails still releases the hold", async () => {
    const c = await composition("execute_explicit_tier1");
    const executor = (c.session as unknown as { executor: { execute: (request: unknown) => Promise<unknown> } }).executor;
    executor.execute = async () => { throw new Error("test: the executor failed"); };
    const run = await runScenario(c, moveScript(c));
    expect(run.rituals[0]).toMatchObject({ ok: false });
    await c.session.whenIdle();
    expect(c.session.historyHoldReason()).toBeNull();
  }, 30_000);
});
