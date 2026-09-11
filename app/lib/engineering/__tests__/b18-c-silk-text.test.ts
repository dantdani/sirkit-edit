/**
 * [B18-C I6] Silkscreen TEXT as a reviewed granted execution:
 *
 *  - add / update / remove build byte-identical operations from the model's
 *    edits and from `planFromOperations` (the browser's recompile); the kinds
 *    are silk only (never `*_text`: board text is not silk and is out of scope);
 *  - an add's id is DETERMINISTIC (base revision + index + content): the same
 *    edit on the same board gives the same id; another base revision or index
 *    gives another; the derived fields follow the editor's own silk tool
 *    (rotation 0, centred, mirrored on the bottom side);
 *  - refusals: a non-text silk item, empty / oversized / non-ASCII text, a
 *    non-silk layer, a sub-0.1 mm height, a zero stroke, too many edits, an
 *    unknown id, the same item twice, a derived-id collision;
 *  - the seal's argument contract: each op carries exactly its fields (null is
 *    absent), an add takes the editor's defaults;
 *  - end to end: confirmation-only — previewed even under
 *    execute_explicit_tier1; the human's Confirm commits ONE transaction whose
 *    board carries the deterministic id.
 */
import { describe, expect, it } from "vitest";
import { makeBoard, makeInstance, makeResistorDef } from "../../pcb/__tests__/autoplace-fixture";
import { mmToNm } from "../../pcb/units";
import type { PcbBoard } from "../../pcb/types";
import type { SilkTextItem } from "../../pcb/silk/types";
import { DEFAULT_SILK_STROKE_NM, DEFAULT_SILK_TEXT_HEIGHT_NM } from "../../pcb/silk/types";
import { aiSilkTextId, buildExecutionOperations, planFromOperations, type BuiltExecution, type SilkTextEdit } from "../execution-operations";
import { parseExecutionArguments } from "../../agent/execution-intents";
import { KERNEL_OPERATION_BINDINGS } from "../executor";
import { tenderConfirmedExecution } from "../../project/granted-execution-controller.internal";
import { call, composition, headOf, ritual, runScenario } from "./b18c-harness";

const FAMILY = "pcb.silkscreen-text" as const;
function fixture(): PcbBoard {
  const board = makeBoard(40, 30, [makeInstance("r3", makeResistorDef(), { x: 5, y: 5 }, { "1": 1, "2": 2 })], 2);
  board.silkItems = [
    { kind: "text", id: "silk-rev", layer: "silkTop", position: { x: mmToNm(30), y: mmToNm(25) }, text: "REV A", heightNm: DEFAULT_SILK_TEXT_HEIGHT_NM, strokeWidthNm: DEFAULT_SILK_STROKE_NM, rotationDeg: 0, mirror: false, anchor: "center" },
    { kind: "line", id: "silk-line", layer: "silkTop", from: { x: 0, y: 0 }, to: { x: mmToNm(5), y: 0 }, strokeWidthNm: DEFAULT_SILK_STROKE_NM },
  ];
  return board;
}
const B = fixture();
const ok = (built: ReturnType<typeof buildExecutionOperations>): BuiltExecution => { if (!built.ok) throw new Error(built.message); return built; };
const build = (edits: SilkTextEdit[], board: PcbBoard = B) => buildExecutionOperations(board, { family: FAMILY, edits });
const ADD: SilkTextEdit = { op: "add", text: "REV B", layer: "silkTop", atNm: { x: mmToNm(10), y: mmToNm(10) }, heightNm: DEFAULT_SILK_TEXT_HEIGHT_NM, strokeWidthNm: DEFAULT_SILK_STROKE_NM };
function recompiled(built: BuiltExecution, board: PcbBoard = B): BuiltExecution {
  const plan = planFromOperations(built.family, built.operations);
  if (!plan) throw new Error("the inverse must rebuild the plan");
  return ok(buildExecutionOperations(board, plan));
}
const same = (a: BuiltExecution, b: BuiltExecution) => {
  expect(b.operationsDigest).toBe(a.operationsDigest);
  expect(b.previewDigest).toBe(a.previewDigest);
  expect(b.resultRevision).toBe(a.resultRevision);
  expect(b.resultLineageDigest).toBe(a.resultLineageDigest);
};

describe("B18-C I6 — silkscreen text builds", () => {
  it("add / update / remove: byte-identical from the edits and from the inverse; silk kinds only; the preview names the change", () => {
    const cases: Array<[string, SilkTextEdit[], string[]]> = [
      ["add", [ADD], ["add_silk"]],
      ["update", [{ op: "update", silkId: "silk-rev", text: "REV B", heightNm: mmToNm(1.5) }], ["update_silk"]],
      ["remove", [{ op: "remove", silkId: "silk-rev" }], ["remove_silk"]],
      ["add + update", [ADD, { op: "update", silkId: "silk-rev", layer: "silkBottom" }], ["add_silk", "update_silk"]],
    ];
    const allowed = (KERNEL_OPERATION_BINDINGS as Record<string, readonly string[]>)[FAMILY]!;
    for (const [label, edits, kinds] of cases) {
      const built = ok(build(edits));
      same(built, recompiled(built));
      expect([...built.operations.map((operation) => operation.kind)].sort(), label).toEqual([...kinds].sort());
      expect(built.operations.every((operation) => allowed.includes(operation.kind) && !operation.kind.endsWith("_text")), label).toBe(true);
      expect(built.targets.kinds, label).toEqual(["text"]);
    }
    expect(ok(build([ADD])).preview).toMatchObject({ before: "(new)", after: 'silk text "REV B" at (10.000, 10.000) mm on top, 1.000 mm high' });
    expect(ok(build([{ op: "remove", silkId: "silk-rev" }])).preview).toMatchObject({ after: "(removed)" });
    const flipped = ok(build([{ op: "update", silkId: "silk-rev", layer: "silkBottom" }]));
    const operation = flipped.operations[0]!;
    if (operation.kind !== "update_silk" || operation.replace.kind !== "text") throw new Error("unreachable");
    expect(operation.replace).toMatchObject({ layer: "silkBottom", mirror: true }); // the editor's set-text-props rule
  });

  it("an add's id is DETERMINISTIC (base revision + index + content) and its derived fields follow the editor's silk tool", () => {
    const first = ok(build([ADD]));
    const again = ok(build([ADD]));
    const add = first.operations[0]!;
    if (add.kind !== "add_silk" || add.item.kind !== "text") throw new Error("unreachable");
    const body: Omit<SilkTextItem, "id"> = { kind: "text", layer: "silkTop", position: { x: mmToNm(10), y: mmToNm(10) }, text: "REV B", heightNm: DEFAULT_SILK_TEXT_HEIGHT_NM, strokeWidthNm: DEFAULT_SILK_STROKE_NM, rotationDeg: 0, mirror: false, anchor: "center" };
    expect(add.item).toEqual({ id: aiSilkTextId(B, 0, body), ...body });
    expect(add.item.id).toMatch(/^silk-ai-[0-9a-f]{16}$/);
    expect(again.operationsDigest).toBe(first.operationsDigest);
    const other = fixture();
    other.footprints[0]!.at = { x: mmToNm(6), y: mmToNm(5) };
    const moved = ok(build([ADD], other)).operations[0]!;
    if (moved.kind !== "add_silk") throw new Error("unreachable");
    expect(moved.item.id).not.toBe(add.item.id); // another base revision
    const two = ok(build([ADD, { ...ADD, atNm: { x: mmToNm(12), y: mmToNm(10) } }]));
    expect(new Set(two.operations.map((operation) => (operation.kind === "add_silk" ? operation.item.id : "")))).toHaveProperty("size", 2);
    const bottom = ok(build([{ ...ADD, layer: "silkBottom" }])).operations[0]!;
    if (bottom.kind !== "add_silk" || bottom.item.kind !== "text") throw new Error("unreachable");
    expect(bottom.item.mirror).toBe(true);
  });

  it("refusals: non-text silk, empty / oversized / non-ASCII text, a non-silk layer, too small, zero stroke, too many, unknown, twice, a derived-id collision", () => {
    expect(build([{ op: "update", silkId: "silk-line", text: "X" }])).toMatchObject({ ok: false, code: "unknown_target" });
    expect(build([{ op: "remove", silkId: "silk-line" }])).toMatchObject({ ok: false, code: "unknown_target" });
    expect(build([{ op: "remove", silkId: "no-such" }])).toMatchObject({ ok: false, code: "unknown_target" });
    for (const text of ["", "x".repeat(65), "Ω ohm", "tab\there"]) expect(build([{ ...ADD, text }]), JSON.stringify(text)).toMatchObject({ ok: false, code: "invalid_geometry" });
    expect(build([{ ...ADD, layer: "copperTop" as "silkTop" }])).toMatchObject({ ok: false, code: "invalid_geometry" });
    expect(build([{ ...ADD, heightNm: 99_999 }])).toMatchObject({ ok: false, code: "invalid_geometry" });
    expect(build([{ ...ADD, strokeWidthNm: 0 }])).toMatchObject({ ok: false, code: "invalid_geometry" });
    expect(build(Array.from({ length: 17 }, (_, index) => ({ ...ADD, atNm: { x: mmToNm(index + 1), y: mmToNm(2) } })))).toMatchObject({ ok: false, code: "too_many" });
    expect(build([{ op: "remove", silkId: "silk-rev" }, { op: "update", silkId: "silk-rev", text: "X" }])).toMatchObject({ ok: false, code: "unknown_target" });
    // A (pinned) add whose id already exists on the board refuses: a replayed or forged grant can never squat an existing item.
    const addItem = (ok(build([ADD])).operations[0] as { item: SilkTextItem }).item;
    expect(buildExecutionOperations(B, { family: FAMILY, mode: "pinned", changes: [{ op: "add", item: { ...addItem, id: "silk-rev" } }] })).toMatchObject({ ok: false, code: "unknown_target" });
    // A pinned change naming a non-text silk item refuses too.
    expect(buildExecutionOperations(B, { family: FAMILY, mode: "pinned", changes: [{ op: "remove", silkId: "silk-line" }] })).toMatchObject({ ok: false, code: "unknown_target" });
  });
});

describe("B18-C I6 — the seal's argument contract", () => {
  const parse = (args: Record<string, unknown>) => parseExecutionArguments(FAMILY, args, B);
  it("each op carries exactly its fields (null is absent); an add takes the editor's defaults", () => {
    expect(parse({ edits: [{ op: "add", text: "REV B", layer: "silkTop", atNm: { x: 1, y: 2 }, silkId: null, heightNm: null, strokeWidthNm: null }] })).toEqual({ ok: true, plan: { family: FAMILY, edits: [{ op: "add", text: "REV B", layer: "silkTop", atNm: { x: 1, y: 2 }, heightNm: DEFAULT_SILK_TEXT_HEIGHT_NM, strokeWidthNm: DEFAULT_SILK_STROKE_NM }] } });
    expect(parse({ edits: [{ op: "update", silkId: "silk-rev", text: "REV C", layer: null, atNm: null, heightNm: null, strokeWidthNm: null }] })).toEqual({ ok: true, plan: { family: FAMILY, edits: [{ op: "update", silkId: "silk-rev", text: "REV C" }] } });
    expect(parse({ edits: [{ op: "remove", silkId: "silk-rev", text: null }] })).toEqual({ ok: true, plan: { family: FAMILY, edits: [{ op: "remove", silkId: "silk-rev" }] } });
    for (const edits of [
      [{ op: "add", text: "X", layer: "silkTop", atNm: { x: 1, y: 2 }, silkId: "silk-rev" }], // a stray silkId
      [{ op: "add", text: "X", layer: "silkTop" }],                                           // no position
      [{ op: "add", text: "X", layer: "silkTop", atNm: { x: 1.5, y: 2 } }],                   // not integer nm
      [{ op: "update", silkId: "silk-rev" }],                                                   // nothing to change
      [{ op: "update", silkId: "silk-rev", atNm: { x: 1, y: 2 } }],                            // update never moves
      [{ op: "remove", silkId: "silk-rev", text: "X" }],                                        // a stray field
      [{ op: "rotate", silkId: "silk-rev" }],                                                    // unknown op
      [{ op: "add", text: "X", layer: "silkTop", atNm: { x: 1, y: 2 }, color: "red" }],          // unknown field
    ]) expect(parse({ edits }), JSON.stringify(edits)).toMatchObject({ ok: false });
    expect(parse({ edits: [ADD], approval: true })).toMatchObject({ ok: false, diagnostics: [expect.stringMatching(/authority-shaped/)] });
  });
});

describe("B18-C I6 — end to end (confirmation-only)", () => {
  it("previewed even under execute_explicit_tier1; the human's Confirm commits ONE transaction whose board carries the deterministic id", async () => {
    const c = await composition("execute_explicit_tier1");
    const args = { edits: [{ op: "add", text: "REV B", layer: "silkTop", atNm: { x: mmToNm(10), y: mmToNm(10) }, silkId: null, heightNm: null, strokeWidthNm: null }] };
    const { adapter, grants, rituals } = await runScenario(c, (_move, tool) => [() => ({ toolCalls: [call("c1", tool("sirkit.pcb.silkscreen-text"), JSON.stringify(args))] }), () => ({ text: "done" })], { message: "Add REV B silkscreen text at 10, 10." });
    expect(rituals).toEqual([]);
    expect(JSON.parse(adapter.continueInputs[0]![0]!.outputText)).toMatchObject({ ok: true, status: "execution_preview_issued", family: "pcb.silkscreen-text", decision: "preview_then_confirm" });
    const pinned = grants[0]!.binding.proposal.operations[0]!;
    if (pinned.kind !== "add_silk") throw new Error("unreachable");
    const before = headOf(c).headSequence;
    expect(await tenderConfirmedExecution(ritual(c, grants[0]!))).toMatchObject({ ok: true, status: "committed" });
    expect(headOf(c).headSequence).toBe(before + 1);
    expect(c.history.committedPresent.silkItems?.find((item) => item.id === pinned.item.id)).toMatchObject({ kind: "text", text: "REV B", layer: "silkTop" });
  }, 30_000);
});
