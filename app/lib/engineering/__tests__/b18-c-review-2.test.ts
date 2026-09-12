/**
 * [B18-C review 2] Regressions for the adversarial review of I4–I6 (recorded in
 * artifacts/remaining-builder-program/EXECUTION_LEDGER.md); each fails on the
 * pre-fix code:
 *
 *  R1 (high)  a preview hid a change: a stroke-only silk update (or a
 *             label-height-only dimension update, or a sub-micron move) read
 *             the same before and after on the only confirmation surface.
 *             Previews now name every field an edit can change and print exact
 *             nanometres; a change whose before and after read the same is
 *             never issued;
 *  R2 (high)  the settlement DRC ran on the kernel's emptied zone fills, so the
 *             zone net's incomplete-net errors were skipped; it now counts on
 *             the board the editor holds once its refill lands;
 *  R3         a multi-target move / rotate / arrange listed out of board order
 *             could never be confirmed (the seal's preview in plan order, the
 *             recompile's in operation order); plans now run in board order;
 *  R4         a no-op edit beside a real one stayed a target, so every Confirm
 *             failed the recompile; a no-op edit is no target;
 *  R5         silk text could spoof the preview (raw quotes) and
 *             whitespace-only text passed; the text is quoted exactly and
 *             leading or trailing spaces refuse (the editor's silk tool trims);
 *  R6         a pinned silk change was re-checked by id only; its content is
 *             now checked as the editor's tool would place or edit it;
 *  R7         the flip grammar and a null-rotation side change kept the
 *             rotation, while the editor's own Flip turns the part over
 *             (rotation 360 − r); both now follow the editor;
 *  R8         "put R3 to the bottom" (no side or layer word) was proven as a
 *             flip; "put" now needs the word;
 *  R9         undo eligibility was claimed on a history the editor had
 *             retired; only the live bound history counts;
 *  R10        the silkscreen-text descriptor named board-inspect as the source
 *             of silk ids (the AI board snapshot lists none).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeBoard, makeInstance, makeResistorDef } from "../../pcb/__tests__/autoplace-fixture";
import { mmToNm } from "../../pcb/units";
import type { PcbBoard } from "../../pcb/types";
import { DEFAULT_SILK_STROKE_NM, DEFAULT_SILK_TEXT_HEIGHT_NM, type SilkTextItem } from "../../pcb/silk/types";
import { runDrc } from "../../pcb/drc/run-drc";
import { DEFAULT_PRESET_ID } from "../../pcb/drc/presets";
import { resolvePcbValidationPolicy } from "../../pcb/proposal/sealed-pcb-edit-proposal";
import { refillZoneFillsAtomically, zoneFillIsCurrent } from "../../pcb/zones/fill-lifecycle";
import { newBoardDimension } from "../../pcb/dimensions/commands";
import { buildExecutionOperations, planFromOperations, type BuiltExecution, type ExecutionPlan, type SilkTextChange } from "../execution-operations";
import { parseExecutionArguments } from "../../agent/execution-intents";
import { deriveExplicitPlan, proveExplicitUserRequest } from "../explicit-request";
import { applyEngineeringOperations } from "../operations";
import { settlementValidations, undoEligibleFor } from "../granted-executions";
import { historyBindingState } from "../editor-adapter";
import { sirkitToolRegistry } from "../tool-catalog";
import { STAGE10_SCHEMA_VERSION } from "../types";
import { composition } from "./b18c-harness";

function board(): PcbBoard {
  const def = makeResistorDef();
  const b = makeBoard(60, 40, [
    makeInstance("r3", def, { x: 5, y: 5 }, { "1": 1, "2": 2 }),
    makeInstance("r4", def, { x: 30, y: 12 }, { "1": 1, "2": 0 }),
    makeInstance("r5", def, { x: 45, y: 25 }, { "1": 2, "2": 0 }),
  ], 2);
  const text = (id: string, x: number, heightNm: number): SilkTextItem => ({ kind: "text", id, layer: "silkTop", position: { x: mmToNm(x), y: mmToNm(35) }, text: id.toUpperCase(), heightNm, strokeWidthNm: DEFAULT_SILK_STROKE_NM, rotationDeg: 0, mirror: false, anchor: "center" });
  b.silkItems = [text("silk-a", 10, DEFAULT_SILK_TEXT_HEIGHT_NM), text("silk-b", 30, 800_000)];
  b.dimensions = [newBoardDimension({ id: "dim-w", kind: "horizontal", a: { x: 0, y: 0 }, b: { x: mmToNm(60), y: 0 }, offsetNm: -mmToNm(3) })];
  return b;
}
const B = board();
const fp = (ref: string, b: PcbBoard = B) => b.footprints.find((f) => f.ref === ref)!;
const ok = (built: ReturnType<typeof buildExecutionOperations>): BuiltExecution => { if (!built.ok) throw new Error(built.message); return built; };
const build = (plan: ExecutionPlan, b: PcbBoard = B) => buildExecutionOperations(b, plan);
function recompiled(built: BuiltExecution, b: PcbBoard = B): BuiltExecution {
  const plan = planFromOperations(built.family, built.operations);
  if (!plan) throw new Error("the inverse must rebuild the plan");
  return ok(buildExecutionOperations(b, plan));
}
function expectSame(a: BuiltExecution, b: BuiltExecution, label: string): void {
  expect(b.operationsDigest, label).toBe(a.operationsDigest);
  expect(b.targets.targetsDigest, label).toBe(a.targets.targetsDigest);
  expect(b.previewDigest, label).toBe(a.previewDigest);
  expect(b.resultRevision, label).toBe(a.resultRevision);
}
const errorsOn = (target: PcbBoard) => runDrc(target, resolvePcbValidationPolicy(DEFAULT_PRESET_ID)!.rules, { presetId: DEFAULT_PRESET_ID }).violations.filter((violation) => violation.severity === "error").length;

describe("B18-C review 2 R1 — a preview never hides a change", () => {
  it("a stroke-only silk update, a height- or stroke-only dimension update and a sub-micron move each read differently before and after", () => {
    const stroke = ok(build({ family: "pcb.silkscreen-text", edits: [{ op: "update", silkId: "silk-a", strokeWidthNm: 300_000 }] }));
    expect(stroke.preview.before).not.toBe(stroke.preview.after);
    expect(stroke.preview.after).toMatch(/0\.300 mm stroke/);
    for (const edit of [{ textHeightNm: 1_500_000 }, { strokeWidthNm: 200_000 }]) {
      const built = ok(build({ family: "pcb.dimension", edits: [{ op: "update", dimensionId: "dim-w", ...edit }] }));
      expect(built.preview.before, JSON.stringify(edit)).not.toBe(built.preview.after);
    }
    const r3 = fp("R3");
    const nudged = ok(build({ family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: r3.at.x + 100, y: r3.at.y }] }));
    expect(nudged.preview.before).not.toBe(nudged.preview.after);
  });
});

describe("B18-C review 2 R2 — the settlement DRC counts the board the editor holds once its refill lands", () => {
  it("after a move re-marks a partial pour dirty, the zone net's incomplete-net error is still counted", () => {
    const b = board();
    const outer = [{ x: 0, y: 0 }, { x: mmToNm(20), y: 0 }, { x: mmToNm(20), y: mmToNm(40) }, { x: 0, y: mmToNm(40) }];
    // A pour on NET_1 (the pads' net — nets[0] is the no-net entry) that reaches R3's pad 1 but not R4's.
    b.zones.push({ id: "zone-gnd", layer: "copperTop", netId: 1, source: "user", polygon: outer, appearance: "solid", connection: "thermal", fill: [], dirty: true });
    const filled = refillZoneFillsAtomically(b);
    expect(filled.zones.every((zone) => zoneFillIsCurrent(filled, zone))).toBe(true);
    const r3 = fp("R3", filled);
    const built = ok(buildExecutionOperations(filled, { family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: r3.at.x + mmToNm(2), y: r3.at.y }] }));
    const committed = applyEngineeringOperations({ schemaVersion: STAGE10_SCHEMA_VERSION, tenantId: "t", projectId: "p", branchId: "b", pcb: filled, pinnedAssets: [] }, built.operations).project.pcb;
    expect(committed.zones.some((zone) => !zoneFillIsCurrent(committed, zone))).toBe(true); // the kernel emptied the fill
    const editorView = errorsOn(refillZoneFillsAtomically(committed));
    expect(editorView).toBeGreaterThan(errorsOn(committed)); // what the emptied fill hides
    expect(settlementValidations(committed, DEFAULT_PRESET_ID)).toEqual({ drc: { ran: true, violations: editorView } });
  });
});

describe("B18-C review 2 R3 — multi-target plans listed out of board order confirm", () => {
  it("move, rotate and arrange in reverse board order rebuild byte-identically from the grant's operations, preview included", () => {
    const [r3, r4, r5] = ["R3", "R4", "R5"].map((ref) => fp(ref));
    const plans: Array<[string, ExecutionPlan]> = [
      ["move", { family: "pcb.move-footprint", moves: [{ footprintId: r5!.id, x: r5!.at.x + mmToNm(1), y: r5!.at.y }, { footprintId: r3!.id, x: r3!.at.x + mmToNm(1), y: r3!.at.y }] }],
      ["rotate", { family: "pcb.rotate-side-footprint", targets: [{ footprintId: r4!.id, rotationDeg: 90, side: "top" }, { footprintId: r3!.id, rotationDeg: 90, side: "top" }] }],
      ["align", { family: "pcb.arrange", mode: "align", footprintIds: [r5!.id, r4!.id, r3!.id], edge: "left" }],
    ];
    for (const [label, plan] of plans) {
      const built = ok(build(plan));
      expect(built.operations.length, label).toBeGreaterThan(1);
      expectSame(built, recompiled(built), label);
    }
  });
});

describe("B18-C review 2 R4 — a no-op edit is no target", () => {
  it("a no-op silk update beside a real one, and a move to where a footprint already is beside a real move: only the changed items are targets and the grant confirms", () => {
    const silk = ok(build({ family: "pcb.silkscreen-text", edits: [{ op: "update", silkId: "silk-a", heightNm: DEFAULT_SILK_TEXT_HEIGHT_NM }, { op: "update", silkId: "silk-b", heightNm: DEFAULT_SILK_TEXT_HEIGHT_NM }] }));
    expect(silk.targets.objectIds).toEqual(["silk-b"]);
    expectSame(silk, recompiled(silk), "silk");
    const [r3, r4] = [fp("R3"), fp("R4")];
    const moves = ok(build({ family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: r3.at.x, y: r3.at.y }, { footprintId: r4.id, x: r4.at.x + mmToNm(1), y: r4.at.y }] }));
    expect(moves.targets.objectIds).toEqual([r4.id]);
    expect(moves.preview.before).not.toMatch(/R3/);
    expectSame(moves, recompiled(moves), "move");
  });
});

describe("B18-C review 2 R5 — silk text is quoted exactly; leading or trailing spaces refuse", () => {
  it("quotes inside the text are escaped in the preview; whitespace-only and padded text refuse", () => {
    const spoof = 'A" at (0.000, 0.000) mm on top, 1.000 mm high; silk text "B';
    const add = { op: "add" as const, text: spoof, layer: "silkTop" as const, atNm: { x: mmToNm(10), y: mmToNm(10) }, heightNm: DEFAULT_SILK_TEXT_HEIGHT_NM, strokeWidthNm: DEFAULT_SILK_STROKE_NM };
    const built = ok(build({ family: "pcb.silkscreen-text", edits: [add] }));
    expect(built.preview.after.startsWith(`silk text ${JSON.stringify(spoof)} at (10.000, 10.000) mm`)).toBe(true);
    expect(built.preview.after).not.toContain('silk text "B"');
    for (const text of ["   ", " REV", "REV "]) expect(build({ family: "pcb.silkscreen-text", edits: [{ ...add, text }] }), JSON.stringify(text)).toMatchObject({ ok: false, code: "invalid_geometry" });
  });
});

describe("B18-C review 2 R6 — a pinned silk change is checked as the editor's tool would place or edit it", () => {
  it("pinned adds with oversized text, a turn, an off-centre anchor, a wrong mirror or a sub-0.1 mm height refuse; a pinned replace may change only what an update changes", () => {
    const base = ok(build({ family: "pcb.silkscreen-text", edits: [{ op: "add", text: "REV C", layer: "silkTop", atNm: { x: mmToNm(10), y: mmToNm(10) }, heightNm: DEFAULT_SILK_TEXT_HEIGHT_NM, strokeWidthNm: DEFAULT_SILK_STROKE_NM }] }));
    const item = (base.operations[0] as { item: SilkTextItem }).item;
    const pinned = (changes: SilkTextChange[]) => buildExecutionOperations(B, { family: "pcb.silkscreen-text", mode: "pinned", changes });
    expect(pinned([{ op: "add", item }])).toMatchObject({ ok: true });
    for (const bad of [{ ...item, text: "x".repeat(65) }, { ...item, rotationDeg: 45 }, { ...item, anchor: "left" as unknown as SilkTextItem["anchor"] }, { ...item, mirror: true }, { ...item, heightNm: 50_000 }]) {
      expect(pinned([{ op: "add", item: bad }]), JSON.stringify(bad).slice(0, 80)).toMatchObject({ ok: false });
    }
    const current = B.silkItems!.find((s) => s.id === "silk-a") as SilkTextItem;
    expect(pinned([{ op: "replace", item: { ...current, position: { x: current.position.x + 1, y: current.position.y } } }])).toMatchObject({ ok: false });
    expect(pinned([{ op: "replace", item: { ...current, rotationDeg: 90 } }])).toMatchObject({ ok: false });
    expect(pinned([{ op: "replace", item: { ...current, mirror: true } }])).toMatchObject({ ok: false }); // mirror follows the layer only
    expect(pinned([{ op: "replace", item: { ...current, text: "REV Z" } }])).toMatchObject({ ok: true });
    expect(pinned([{ op: "replace", item: { ...current, layer: "silkBottom", mirror: true } }])).toMatchObject({ ok: true });
  });
});

describe("B18-C review 2 R7 — a flip turns the part over the way the editor's own Flip does", () => {
  it("the grammar and a null-rotation side change derive rotation 360 − r (the editor's flipSelection); a given rotation or an unchanged side keeps it", () => {
    const b = board();
    const r3 = fp("R3", b);
    r3.rotationDeg = 90;
    expect(deriveExplicitPlan("Flip R3 to the bottom.", "pcb.rotate-side-footprint", b)).toMatchObject({ plan: { targets: [{ footprintId: r3.id, rotationDeg: 270, side: "bottom" }] } });
    expect(parseExecutionArguments("pcb.rotate-side-footprint", { targets: [{ footprintId: r3.id, rotationDeg: null, side: "bottom" }] }, b)).toEqual({ ok: true, plan: { family: "pcb.rotate-side-footprint", targets: [{ footprintId: r3.id, rotationDeg: 270, side: "bottom" }] } });
    expect(parseExecutionArguments("pcb.rotate-side-footprint", { targets: [{ footprintId: r3.id, rotationDeg: 90, side: "bottom" }] }, b)).toMatchObject({ ok: true, plan: { targets: [{ rotationDeg: 90, side: "bottom" }] } });
    expect(parseExecutionArguments("pcb.rotate-side-footprint", { targets: [{ footprintId: r3.id, rotationDeg: null, side: "top" }] }, b)).toMatchObject({ ok: true, plan: { targets: [{ rotationDeg: 90, side: "top" }] } });
    const flipped = ok(buildExecutionOperations(b, { family: "pcb.rotate-side-footprint", targets: [{ footprintId: r3.id, rotationDeg: 270, side: "bottom" }] }));
    expect(proveExplicitUserRequest({ userMessage: "Flip R3 to the bottom.", family: "pcb.rotate-side-footprint", board: b, operationsDigest: flipped.operationsDigest })).toMatchObject({ proven: true });
    // The reference is the editor's own Flip (select-move.ts flipSelection): keep `at`, negate the rotation.
    expect(readFileSync(join(process.cwd(), "app", "lib", "pcb", "tools", "select-move.ts"), "utf8")).toContain("rotationDeg: (360 - fp.rotationDeg) % 360");
  });
});

describe("B18-C review 2 R8 — 'put' needs the side or layer word", () => {
  it("'Put R3 to the bottom' is never proven; 'Put R3 to the bottom layer' and 'Flip R3 to the bottom' still are", () => {
    const r3 = fp("R3");
    const built = ok(build({ family: "pcb.rotate-side-footprint", targets: [{ footprintId: r3.id, rotationDeg: 0, side: "bottom" }] }));
    const prove = (text: string) => proveExplicitUserRequest({ userMessage: text, family: "pcb.rotate-side-footprint", board: B, operationsDigest: built.operationsDigest });
    expect(prove("Put R3 to the bottom")).toMatchObject({ proven: false });
    expect(prove("Put R3 onto the bottom.")).toMatchObject({ proven: false });
    expect(prove("Put R3 to the bottom layer")).toMatchObject({ proven: true });
    expect(prove("Flip R3 to the bottom")).toMatchObject({ proven: true });
  });
});

describe("B18-C review 2 R9 — undo eligibility needs the LIVE bound history", () => {
  it("a history whose session was retired (a board-lifecycle adoption) never claims its change undoable", async () => {
    const c = await composition("proposal_only");
    const r4 = c.history.committedPresent.footprints.find((f) => f.ref === "R4")!;
    const built = ok(buildExecutionOperations(c.history.committedPresent, { family: "pcb.move-footprint", moves: [{ footprintId: r4.id, x: r4.at.x + mmToNm(1), y: r4.at.y }] }));
    const result = await c.session.commit({ commandId: "pcb.move-footprint", label: "human move", buildOperations: () => built.operations });
    if (!result.ok || !result.transactionId) throw new Error("the human commit must land");
    expect(undoEligibleFor(c.history, result.transactionId)).toBe(true);
    c.session.dispose();
    expect(historyBindingState(c.history)).toBe("retired");
    expect(undoEligibleFor(c.history, result.transactionId)).toBe(false);
  }, 30_000);
});

describe("B18-C review 2 R10 — the silkscreen-text descriptor names the real id sources", () => {
  it("the AI board snapshot lists no silk items, so the descriptor points at selection-inspect and executed results instead of board-inspect", () => {
    const silk = sirkitToolRegistry().get("sirkit.pcb.silkscreen-text")!;
    expect(silk.description).not.toMatch(/board-inspect/);
    expect(JSON.stringify(silk.inputSchema)).not.toMatch(/board-inspect/);
    expect(silk.description).toMatch(/selection-inspect/);
    expect(readFileSync(join(process.cwd(), "app", "lib", "pcb", "ai", "snapshot.ts"), "utf8")).not.toMatch(/silkItems|dimensions/); // the premise
  });
});
