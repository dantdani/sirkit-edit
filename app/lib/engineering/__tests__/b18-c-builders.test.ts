/**
 * [B18-C I5] The per-family builders and the ONE inverse:
 *
 *  - rotate/flip: rotation-only, side-only and both build byte-identical
 *    operations, preview and expected revision from the plan and from
 *    `planFromOperations` (the browser's recompile); the operations are
 *    `move_footprint` (the family's kernel binding) with the position
 *    untouched; the preview names only what changes;
 *  - arrange: align / distribute / snap-to-grid build the editor's OWN
 *    arrangement, pinned as absolute positions; the recompile from the grant's
 *    operations is byte-identical; footprints that do not move are not targets;
 *  - refusals: unknown, duplicate, locked, no change, too many, fractional or
 *    out-of-range rotation, a bad side, too few to align or distribute, a bad
 *    grid; the inverse refuses foreign kinds, empty lists and other families.
 */
import { describe, expect, it } from "vitest";
import { compileEdits } from "../../pcb/edit/apply";
import type { EditCommand } from "../../pcb/edit/commands";
import { makeBoard, makeInstance, makeResistorDef } from "../../pcb/__tests__/autoplace-fixture";
import { mmToNm } from "../../pcb/units";
import { buildExecutionOperations, planFromOperations, type ArrangePlan, type BuiltExecution, type ExecutionPlan, type RotateSidePlan } from "../execution-operations";
import { KERNEL_OPERATION_BINDINGS } from "../executor";

function fixture() {
  const def = makeResistorDef();
  return makeBoard(60, 40, [
    makeInstance("r3", def, { x: 5, y: 5 }, { "1": 1, "2": 2 }),
    makeInstance("r4", def, { x: 30, y: 12 }, { "1": 1, "2": 0 }),
    makeInstance("r5", def, { x: 45, y: 25 }, { "1": 2, "2": 0 }),
    makeInstance("u1", def, { x: 20, y: 30 }, { "1": 2, "2": 0 }, { locked: true }),
  ], 2);
}
const B = fixture();
const byRef = (ref: string) => B.footprints.find((f) => f.ref === ref)!;
const ok = (built: ReturnType<typeof buildExecutionOperations>): BuiltExecution => { if (!built.ok) throw new Error(built.message); return built; };
function recompiled(built: BuiltExecution): BuiltExecution {
  const plan = planFromOperations(built.family, built.operations);
  if (!plan) throw new Error("the inverse must rebuild the plan");
  return ok(buildExecutionOperations(B, plan));
}
function expectSame(a: BuiltExecution, b: BuiltExecution, label: string): void {
  expect(b.operationsDigest, label).toBe(a.operationsDigest);
  expect(b.previewDigest, label).toBe(a.previewDigest);
  expect(b.resultRevision, label).toBe(a.resultRevision);
  expect(b.resultLineageDigest, label).toBe(a.resultLineageDigest);
}
const kernelKinds = (family: string): readonly string[] => (KERNEL_OPERATION_BINDINGS as Record<string, readonly string[]>)[family] ?? [];

describe("B18-C I5 — rotate / flip", () => {
  it("rotation-only, side-only and both: byte-identical from the plan and from the grant's operations; move_footprint only; the position untouched; the preview names only what changes", () => {
    const r3 = byRef("R3");
    expect(r3).toMatchObject({ rotationDeg: 0, side: "top" });
    const cases: Array<[string, RotateSidePlan, string, string]> = [
      ["rotation only", { family: "pcb.rotate-side-footprint", targets: [{ footprintId: r3.id, rotationDeg: 90, side: "top" }] }, "R3 rotation 0°", "R3 rotation 90°"],
      ["side only", { family: "pcb.rotate-side-footprint", targets: [{ footprintId: r3.id, rotationDeg: 0, side: "bottom" }] }, "R3 side top", "R3 side bottom"],
      ["both", { family: "pcb.rotate-side-footprint", targets: [{ footprintId: r3.id, rotationDeg: 270, side: "bottom" }] }, "R3 rotation 0°, side top", "R3 rotation 270°, side bottom"],
    ];
    for (const [label, plan, before, after] of cases) {
      const built = ok(buildExecutionOperations(B, plan));
      expectSame(built, recompiled(built), label);
      expect(built.operations.every((operation) => kernelKinds("pcb.rotate-side-footprint").includes(operation.kind)), label).toBe(true);
      expect(built.operations[0], label).toMatchObject({ kind: "move_footprint", footprintId: r3.id, at: r3.at, rotationDeg: plan.targets[0]!.rotationDeg, side: plan.targets[0]!.side });
      expect(built.preview, label).toMatchObject({ before, after });
      expect(compileEdits(B, built.commands).result.footprints.find((f) => f.id === r3.id)!.at, label).toEqual(r3.at);
    }
  });

  it("refusals: unknown, duplicate, locked, no change, too many, fractional / negative / 360, a bad side, empty", () => {
    const r3 = byRef("R3");
    const rotate = (targets: RotateSidePlan["targets"]) => buildExecutionOperations(B, { family: "pcb.rotate-side-footprint", targets });
    expect(rotate([{ footprintId: "no-such", rotationDeg: 90, side: "top" }])).toMatchObject({ ok: false, code: "unknown_target" });
    expect(rotate([{ footprintId: r3.id, rotationDeg: 90, side: "top" }, { footprintId: r3.id, rotationDeg: 180, side: "top" }])).toMatchObject({ ok: false, code: "unknown_target" });
    expect(rotate([{ footprintId: byRef("U1").id, rotationDeg: 90, side: "top" }])).toMatchObject({ ok: false, code: "locked_target" });
    expect(rotate([{ footprintId: r3.id, rotationDeg: 0, side: "top" }])).toMatchObject({ ok: false, code: "no_change" });
    expect(rotate(Array.from({ length: 17 }, (_, index) => ({ footprintId: `x${index}`, rotationDeg: 0, side: "top" as const })))).toMatchObject({ ok: false, code: "too_many" });
    for (const rotationDeg of [45.5, -90, 360]) expect(rotate([{ footprintId: r3.id, rotationDeg, side: "top" }]), String(rotationDeg)).toMatchObject({ ok: false, code: "invalid_geometry" });
    expect(rotate([{ footprintId: r3.id, rotationDeg: 90, side: "middle" as "top" }])).toMatchObject({ ok: false, code: "invalid_geometry" });
    expect(rotate([])).toMatchObject({ ok: false, code: "empty" });
  });
});

describe("B18-C I5 — arrange", () => {
  const ids = ["R3", "R4", "R5"].map((ref) => byRef(ref).id);
  const refs = (list: string[]) => list.map((id) => ({ kind: "footprint" as const, id }));

  it("align / distribute / snap-to-grid build the editor's OWN arrangement as absolute positions; the recompile from the grant's operations is byte-identical; unmoved footprints are not targets", () => {
    const cases: Array<[string, ArrangePlan, EditCommand]> = [
      ["align left", { family: "pcb.arrange", mode: "align", footprintIds: ids.slice(0, 2), edge: "left" }, { op: "align", refs: refs(ids.slice(0, 2)), mode: "left" }],
      ["align centerV", { family: "pcb.arrange", mode: "align", footprintIds: ids, edge: "centerV" }, { op: "align", refs: refs(ids), mode: "centerV" }],
      ["distribute h", { family: "pcb.arrange", mode: "distribute", footprintIds: ids, axis: "h" }, { op: "distribute", refs: refs(ids), axis: "h" }],
      ["snap to 4 mm", { family: "pcb.arrange", mode: "snap-to-grid", footprintIds: ids, gridNm: mmToNm(4) }, { op: "snap-to-grid", refs: refs(ids), gridNm: mmToNm(4) }],
    ];
    for (const [label, plan, command] of cases) {
      const arranged = compileEdits(B, [command]);
      expect(arranged.errors, label).toEqual([]);
      const moved = ids.filter((id) => {
        const was = B.footprints.find((f) => f.id === id)!.at;
        const now = arranged.result.footprints.find((f) => f.id === id)!.at;
        return was.x !== now.x || was.y !== now.y;
      });
      if (moved.length === 0) { expect(buildExecutionOperations(B, plan), label).toMatchObject({ ok: false, code: "no_change" }); continue; }
      const built = ok(buildExecutionOperations(B, plan));
      expectSame(built, recompiled(built), label);
      expect(planFromOperations("pcb.arrange", built.operations), label).toMatchObject({ family: "pcb.arrange", mode: "positions" });
      expect(built.operations.every((operation) => kernelKinds("pcb.arrange").includes(operation.kind)), label).toBe(true);
      for (const operation of built.operations) {
        if (operation.kind !== "move_footprint") throw new Error("unreachable");
        expect(operation.at, `${label} ${operation.footprintId}`).toEqual(arranged.result.footprints.find((f) => f.id === operation.footprintId)!.at);
      }
      expect([...built.targets.objectIds].sort(), label).toEqual([...moved].sort());
    }
  });

  it("refusals: too few to align or distribute (the editor's own rules), a locked footprint, unknown / duplicate ids, a bad grid; an arrangement already in place changes nothing", () => {
    const [r3, r4] = ids;
    type ArrangeParams = ArrangePlan extends infer P ? (P extends { footprintIds: string[] } ? Omit<P, "family"> : never) : never; // distributive: one Omit per mode
    const arrange = (plan: ArrangeParams) => buildExecutionOperations(B, { family: "pcb.arrange", ...plan } as ExecutionPlan);
    expect(arrange({ mode: "align", footprintIds: [r3!], edge: "left" })).toMatchObject({ ok: false, code: "compile_failed", message: expect.stringMatching(/at least two/) });
    expect(arrange({ mode: "distribute", footprintIds: [r3!, r4!], axis: "h" })).toMatchObject({ ok: false, code: "compile_failed", message: expect.stringMatching(/at least three/) });
    expect(arrange({ mode: "align", footprintIds: [r3!, byRef("U1").id], edge: "left" })).toMatchObject({ ok: false, code: "locked_target" });
    expect(arrange({ mode: "align", footprintIds: [r3!, "no-such"], edge: "left" })).toMatchObject({ ok: false, code: "unknown_target" });
    expect(arrange({ mode: "align", footprintIds: [r3!, r3!], edge: "left" })).toMatchObject({ ok: false, code: "unknown_target" });
    for (const gridNm of [0, -5, 1.5]) expect(arrange({ mode: "snap-to-grid", footprintIds: [r3!], gridNm }), String(gridNm)).toMatchObject({ ok: false, code: "invalid_geometry" });
    const aligned = compileEdits(B, [{ op: "align", refs: refs([r3!, r4!]), mode: "left" }]).result;
    expect(buildExecutionOperations(aligned, { family: "pcb.arrange", mode: "align", footprintIds: [r3!, r4!], edge: "left" })).toMatchObject({ ok: false, code: "no_change" });
  });
});

describe("B18-C I5 — the ONE inverse", () => {
  it("a move grant rebuilds as its move plan; foreign kinds, empty lists and families without a builder refuse", () => {
    const r3 = byRef("R3");
    const moved = ok(buildExecutionOperations(B, { family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: mmToNm(7), y: mmToNm(5) }] }));
    expect(planFromOperations("pcb.move-footprint", moved.operations)).toEqual({ family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: mmToNm(7), y: mmToNm(5) }] });
    expectSame(moved, recompiled(moved), "move");
    expect(planFromOperations("pcb.move-footprint", [])).toBeNull();
    expect(planFromOperations("pcb.silkscreen-text", moved.operations)).toBeNull();
    expect(planFromOperations("pcb.move-footprint", [{ ...moved.operations[0]!, kind: "set_footprint_protection" } as never])).toBeNull();
  });
});
