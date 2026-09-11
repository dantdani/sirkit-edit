/**
 * [B18-D I4] The editor's ritual reports what it settled with (chat-execution-ux.md §1 items 7, 8 and 10): a committed
 * outcome carries the checks the editor ran on the committed board — the same values the server settlement received —
 * and whether the change is still undoable; an execution that was already applied carries no checks and the live undo
 * eligibility. The page turns these into the chat's execution entry (I6); before this, the confirmed preview's checks
 * were visible nowhere and the notice claimed "Undo restores the exact previous board" unconditionally.
 */
import { describe, expect, it } from "vitest";
import { mmToNm } from "../../pcb/units";
import { buildExecutionOperations } from "../execution-operations";
import { tenderConfirmedExecution } from "../../project/granted-execution-controller.internal";
import { call, composition, movesBy, ritual, runScenario, type Composed } from "./b18c-harness";

const moveScript = (c: Composed, dxMm = 2) => (move: string) => [() => ({ toolCalls: [call("c1", move, movesBy(c, dxMm))] }), () => ({ text: "done" })];
function captureSettles(c: Composed): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = [];
  const real = c.transport.settle.bind(c.transport);
  c.transport.settle = async (scope, body, signal) => { bodies.push(JSON.parse(JSON.stringify(body)) as Record<string, unknown>); return real(scope, body, signal); };
  return bodies;
}

describe("B18-D I4 — the ritual reports what it settled with", () => {
  it("an explicit commit returns the checks and the undo eligibility it settled the server record with", async () => {
    const c = await composition("execute_explicit_tier1");
    const settles = captureSettles(c);
    const { rituals } = await runScenario(c, moveScript(c));
    const outcome = rituals[0]!;
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome).toMatchObject({ status: "committed", undoEligible: true, validations: { drc: { ran: expect.any(Boolean), violations: expect.any(Number) } } });
    const settlement = settles.at(-1)!.settlement as { validations: unknown; undoEligible: unknown };
    expect(outcome.validations).toEqual(settlement.validations);
    expect(outcome.undoEligible).toBe(settlement.undoEligible);
  }, 30_000);

  it("a preview the human confirms reports the same; re-tendering it after a human change reports already-applied, no checks and not undoable", async () => {
    const c = await composition("execute_explicit_tier1");
    const asked = await runScenario(c, moveScript(c), { message: "Could you move R3 2 mm to the right?" });
    const grant = asked.grants[0]!;
    const confirmed = await tenderConfirmedExecution(ritual(c, grant));
    if (!confirmed.ok) throw new Error(confirmed.message);
    expect(confirmed).toMatchObject({ status: "committed", undoEligible: true, validations: { drc: expect.any(Object) } });
    const r4 = c.history.committedPresent.footprints.find((footprint) => footprint.ref === "R4")!;
    const built = buildExecutionOperations(c.history.committedPresent, { family: "pcb.move-footprint", moves: [{ footprintId: r4.id, x: r4.at.x + mmToNm(1), y: r4.at.y }] });
    if (!built.ok) throw new Error(built.message);
    expect((await c.session.commit({ commandId: "pcb.move-footprint", label: "human move", buildOperations: () => built.operations })).ok).toBe(true);
    expect(await tenderConfirmedExecution(ritual(c, grant))).toMatchObject({ ok: true, status: "already-applied", validations: null, undoEligible: false });
  }, 30_000);
});
