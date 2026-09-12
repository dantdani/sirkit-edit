/**
 * [B18-C I5] rotate/flip and arrange END TO END over the shared in-process
 * harness (the real loop, gateway, minter, consume/settle, the page's SAFE
 * receiver and the ritual over a real canonical session):
 *
 *  - "Rotate R3 90 degrees clockwise." under execute_explicit_tier1: the
 *    model's absolute rotation is proven, ONE transaction lands and the model
 *    is told `executed`; the position is untouched;
 *  - "Flip R3 to the bottom." with a null rotation: the seal follows the
 *    editor's own Flip (rotation 360 − r; R3 at 0° stays 0°); the side changes;
 *  - a rotation that differs from the sentence is only previewed;
 *  - arrange has no explicit grammar: even under execute_explicit_tier1 it is
 *    previewed, and the human's Confirm commits exactly the editor's own
 *    alignment (the grant's pinned positions).
 */
import { describe, expect, it } from "vitest";
import { compileEdits } from "../../pcb/edit/apply";
import { tenderConfirmedExecution } from "../../project/granted-execution-controller.internal";
import { call, composition, headOf, ritual, runScenario, type Composed } from "./b18c-harness";

type Answer = Record<string, unknown>;
const answerOf = (adapter: { continueInputs: ReadonlyArray<ReadonlyArray<{ outputText: string }>> }): Answer => JSON.parse(adapter.continueInputs[0]![0]!.outputText) as Answer;
const footprint = (c: Composed, ref: string) => c.history.committedPresent.footprints.find((f) => f.ref === ref)!;
const ROTATE = "sirkit.pcb.rotate-side-footprint";
const ARRANGE = "sirkit.pcb.arrange";

describe("B18-C I5 — rotate / flip end to end", () => {
  it("'Rotate R3 90 degrees clockwise.' — proven, ONE transaction, executed; the position is untouched", async () => {
    const c = await composition("execute_explicit_tier1");
    const r3 = footprint(c, "R3");
    const target = (((r3.rotationDeg - 90) % 360) + 360) % 360;
    const before = headOf(c).headSequence;
    const { adapter, rituals } = await runScenario(c, (_move, tool) => [() => ({ toolCalls: [call("c1", tool(ROTATE), JSON.stringify({ targets: [{ footprintId: r3.id, rotationDeg: target, side: null }] }))] }), () => ({ text: "done" })], { message: "Rotate R3 90 degrees clockwise." });
    expect(rituals[0]).toMatchObject({ ok: true, status: "committed", settled: "settled" });
    expect(answerOf(adapter)).toMatchObject({ ok: true, status: "executed", family: "pcb.rotate-side-footprint", decision: "execute_explicit", after: `R3 rotation ${target}°`, understood: { coverage: "whole-message" } });
    expect(footprint(c, "R3")).toMatchObject({ rotationDeg: target, at: r3.at, side: r3.side });
    expect(headOf(c).headSequence).toBe(before + 1);
  }, 30_000);

  it("'Flip R3 to the bottom.' with a null rotation — the seal follows the editor's Flip (R3 at 0° stays 0°); the side changes", async () => {
    const c = await composition("execute_explicit_tier1");
    const r3 = footprint(c, "R3");
    const { adapter, rituals } = await runScenario(c, (_move, tool) => [() => ({ toolCalls: [call("c1", tool(ROTATE), JSON.stringify({ targets: [{ footprintId: r3.id, rotationDeg: null, side: "bottom" }] }))] }), () => ({ text: "done" })], { message: "Flip R3 to the bottom." });
    expect(rituals[0]).toMatchObject({ ok: true, status: "committed" });
    expect(answerOf(adapter)).toMatchObject({ ok: true, status: "executed", after: "R3 side bottom" });
    expect(footprint(c, "R3")).toMatchObject({ side: "bottom", rotationDeg: r3.rotationDeg, at: r3.at });
  }, 30_000);

  it("a rotation that differs from the sentence is only previewed — nothing changes", async () => {
    const c = await composition("execute_explicit_tier1");
    const r3 = footprint(c, "R3");
    const before = headOf(c).headSequence;
    const { adapter, rituals } = await runScenario(c, (_move, tool) => [() => ({ toolCalls: [call("c1", tool(ROTATE), JSON.stringify({ targets: [{ footprintId: r3.id, rotationDeg: (r3.rotationDeg + 90) % 360, side: null }] }))] }), () => ({ text: "done" })], { message: "Rotate R3 90 degrees clockwise." });
    expect(rituals).toEqual([]);
    expect(answerOf(adapter)).toMatchObject({ ok: true, status: "execution_preview_issued", decision: "preview_then_confirm", understood: { coverage: "unproven" } });
    expect(headOf(c).headSequence).toBe(before);
  }, 30_000);
});

describe("B18-C I5 — arrange end to end", () => {
  it("align left has no explicit grammar: previewed even under execute_explicit_tier1; the human's Confirm commits exactly the editor's own alignment", async () => {
    const c = await composition("execute_explicit_tier1");
    const r3 = footprint(c, "R3");
    const r4 = footprint(c, "R4");
    const expected = compileEdits(c.history.committedPresent, [{ op: "align", refs: [{ kind: "footprint", id: r3.id }, { kind: "footprint", id: r4.id }], mode: "left" }]).result;
    const { adapter, grants, rituals } = await runScenario(c, (_move, tool) => [() => ({ toolCalls: [call("c1", tool(ARRANGE), JSON.stringify({ mode: "align", footprintIds: [r3.id, r4.id], edge: "left", axis: null, gridNm: null }))] }), () => ({ text: "done" })], { message: "Align R3 and R4 to the left." });
    expect(rituals).toEqual([]);
    expect(answerOf(adapter)).toMatchObject({ ok: true, status: "execution_preview_issued", family: "pcb.arrange", decision: "preview_then_confirm", confirmationRequired: true });
    const before = headOf(c).headSequence;
    const confirmed = await tenderConfirmedExecution(ritual(c, grants[0]!));
    expect(confirmed).toMatchObject({ ok: true, status: "committed", receipt: { approvalActor: "human:confirmed-preview" } });
    for (const ref of ["R3", "R4"]) expect(footprint(c, ref).at, ref).toEqual(expected.footprints.find((f) => f.ref === ref)!.at);
    expect(headOf(c).headSequence).toBe(before + 1);
  }, 30_000);
});
