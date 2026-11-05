/**
 * [PR-D] UI/AI parity for the six reviewed granted-execution families (D.6,
 * D.10). From byte-identical start boards, the UI path (the editor's own
 * EditCommand batch or candidate: `applyEditsCanonical` / `commitPcbCandidate`
 * → `CanonicalEditorSession.commit`) and the AI path (the tool call → sealed
 * intent → server-minted grant → the human's Confirm → the SAME
 * `CanonicalEditorSession.commit`) land the IDENTICAL board (fill-normalized
 * lineage digest, semantic revision and the executor's canonical state digests
 * before and after), one head advance each.
 *
 * The same invalid input is refused on both sides with nothing committed; the
 * closed code each side reports is pinned side by side. Where the two sides
 * DIVERGE the divergence is pinned as it is and named GAP in the title — a
 * finding for the D.1 matrix, never papered over:
 *  - silk / dimension ADD ids: the editor's are salted counters, the AI's are
 *    deterministic (B18-C I6/I7) — identical modulo the id;
 *  - a dimension REMOVE runs under `pcb.delete-item` from the editor's Delete
 *    and under `pcb.dimension` from the AI (two command ids, two tiers);
 *  - the AI builder is STRICTER than the editor's validator (fractional
 *    nanometres, out-of-range rotations) and REFUSES with its own closed codes
 *    where the editor's validator has none (validate.ts: "no codes").
 */
import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { mmToNm } from "../../pcb/units";
import type { PcbBoard } from "../../pcb/types";
import type { EditCommand } from "../../pcb/edit/commands";
import type { SilkTextItem } from "../../pcb/silk/types";
import { compileEdits } from "../../pcb/edit/apply";
import { mutateBoardWithSilkCommand } from "../../pcb/silk/commands";
import { DEFAULT_SILK_STROKE_NM, DEFAULT_SILK_TEXT_HEIGHT_NM } from "../../pcb/silk/types";
import { DIMENSION_DEFAULTS, mutateBoardWithDimensionCommand, newBoardDimension } from "../../pcb/dimensions/commands";
import { commitPcbCandidate } from "../pcb-commit-gateway";
import { applyEditsCanonical } from "../editor-adapter";
import { buildExecutionOperations, type BuildRefusal, type ExecutionPlan } from "../execution-operations";
import { canonicalLineageDigest } from "../semantic-board-digest";
import { REPLAY_COMMAND_ID } from "../executor";
import { headOf, runContext } from "./b18c-harness";
import { ARRANGE_TOOL, DIMENSION_TOOL, MOVE_TOOL, ROTATE_TOOL, SILK_TOOL, UNDO_TOOL, aiCommit, annotatedBoard, composeFrom, digestOf, footprintOf, gatewayFor, invokeTool, lastCanonicalStatesOf, lastExecutedCommandOf, mark, pair, revisionOf, spyMinter, uiCommit, type Pair, type StartMark } from "./fixtures/pr-d-parity-harness";

const NULLS_SILK = { silkId: null, text: null, layer: null, atNm: null, heightNm: null, strokeWidthNm: null };
const NULLS_DIM = { dimensionId: null, kind: null, a: null, b: null, offsetNm: null, layer: null, unit: null, precision: null, textHeightNm: null, strokeWidthNm: null };
const footprintRef = (id: string) => ({ kind: "footprint" as const, id });

/** Both sides moved off the start by the same one step and now hold the identical board. */
function expectSameEffect(p: Pair, start: StartMark, advance = 1): void {
  expect(digestOf(p.ai)).toBe(digestOf(p.ui));
  expect(revisionOf(p.ai)).toBe(revisionOf(p.ui));
  const states = lastCanonicalStatesOf(p.ui);
  expect(states.revisionBefore, "the UI entry records its canonical states").toMatch(/^eng1-/);
  expect(lastCanonicalStatesOf(p.ai), "the executor's canonical state digests before and after").toEqual(states);
  expect(headOf(p.ui).headSequence).toBe(start.head + advance);
  expect(headOf(p.ai).headSequence).toBe(start.head + advance);
}

/** The board with every ADDED silk text / dimension id (the editor's salted counter, the AI's deterministic id) renamed alike. */
function digestModuloNewIds(board: PcbBoard): string {
  return canonicalLineageDigest(produce(board, (draft) => {
    for (const item of draft.silkItems ?? []) if (/^silk-(ui|ai)-/.test(item.id)) item.id = "silk-new";
    for (const item of draft.dimensions ?? []) if (/^dim-(ui|ai)-/.test(item.id)) item.id = "dim-new";
  }));
}

describe("PR-D parity (a) — equal permitted effects: the editor's commit and the AI's granted execution land the identical board", () => {
  it("move-footprint: the inspector's set-position and the AI's move grant land the identical board (lineage digest, revision, change set); one head advance each", async () => {
    const p = await pair();
    const r3 = footprintOf(p.ui, "R3");
    const target = { x: r3.at.x + mmToNm(2), y: r3.at.y };
    await uiCommit(p.ui, [{ op: "set-position", ref: footprintRef(r3.id), atNm: target }]);
    await aiCommit(p.ai, MOVE_TOOL, { moves: [{ footprintId: r3.id, x: target.x, y: target.y }] }, "Move R3 2 mm to the right.");
    expectSameEffect(p, p.start);
    expect(digestOf(p.ui)).not.toBe(p.start.digest);
    expect(footprintOf(p.ai, "R3").at).toEqual(target);
  }, 60_000);

  it("rotate-side-footprint: the inspector's set-footprint-props and the AI's rotate/flip grant land the identical board", async () => {
    const p = await pair();
    const r3 = footprintOf(p.ui, "R3");
    await uiCommit(p.ui, [{ op: "set-footprint-props", id: r3.id, patch: { rotationDeg: 90, side: "bottom" } }]);
    await aiCommit(p.ai, ROTATE_TOOL, { targets: [{ footprintId: r3.id, rotationDeg: 90, side: "bottom" }] }, "Rotate R3 to 90 degrees and flip it to the bottom.");
    expectSameEffect(p, p.start);
    expect(footprintOf(p.ai, "R3")).toMatchObject({ rotationDeg: 90, side: "bottom", at: r3.at });
  }, 60_000);

  it("arrange: the editor's align-left and the AI's arrange grant (the editor's own alignment, pinned as positions) land the identical board", async () => {
    const p = await pair();
    const refs = ["R3", "R4"].map((ref) => footprintOf(p.ui, ref).id);
    await uiCommit(p.ui, [{ op: "align", refs: refs.map(footprintRef), mode: "left" }]);
    await aiCommit(p.ai, ARRANGE_TOOL, { mode: "align", footprintIds: refs, edge: "left", axis: null, gridNm: null }, "Align R3 and R4 to the left.");
    expectSameEffect(p, p.start);
    expect(footprintOf(p.ai, "R4").at.x).toBe(footprintOf(p.ai, "R3").at.x);
  }, 60_000);

  it("silkscreen-text: an UPDATE (set-text-props ≡ the AI's update) lands identically; an ADD lands identically modulo the id — GAP: the editor's silk ids are salted counters (useSilkTool.ts:38), the AI's are deterministic silk-ai-* (execution-operations.ts:93)", async () => {
    const p = await pair(annotatedBoard());
    await uiCommit(p.ui, [{ op: "set-text-props", id: "silk-rev", patch: { text: "REV B" } }]);
    await aiCommit(p.ai, SILK_TOOL, { edits: [{ ...NULLS_SILK, op: "update", silkId: "silk-rev", text: "REV B" }] }, "Change the REV A silkscreen text to REV B.");
    expectSameEffect(p, p.start);
    // ADD: the editor's silk tool commits the SAME AddSilk command through the canonical commit gateway, with its own id.
    const after = mark(p.ui);
    const item: SilkTextItem = { kind: "text", id: "silk-ui-1", layer: "silkTop", position: { x: mmToNm(10), y: mmToNm(10) }, text: "ASSY", heightNm: DEFAULT_SILK_TEXT_HEIGHT_NM, strokeWidthNm: DEFAULT_SILK_STROKE_NM, rotationDeg: 0, mirror: false, anchor: "center" };
    const added = await commitPcbCandidate(p.ui.history, { commandId: "pcb.silkscreen-text", label: "Add silk text", buildCandidate: (board) => produce(board, (draft) => mutateBoardWithSilkCommand(draft, { kind: "AddSilk", item })) });
    expect(added).toMatchObject({ ok: true, status: "executed" });
    const { grant } = await aiCommit(p.ai, SILK_TOOL, { edits: [{ ...NULLS_SILK, op: "add", text: "ASSY", layer: "silkTop", atNm: { x: mmToNm(10), y: mmToNm(10) } }] }, "Add ASSY silkscreen text at 10, 10.");
    const pinned = grant.binding.proposal.operations[0]!;
    if (pinned.kind !== "add_silk") throw new Error("unreachable");
    expect(pinned.item.id).toMatch(/^silk-ai-[0-9a-f]{16}$/);
    expect(digestOf(p.ai), "GAP pinned: the raw digests differ by the id alone").not.toBe(digestOf(p.ui));
    expect(digestModuloNewIds(p.ai.history.committedPresent)).toBe(digestModuloNewIds(p.ui.history.committedPresent));
    expect(headOf(p.ui).headSequence).toBe(after.head + 1);
    expect(headOf(p.ai).headSequence).toBe(after.head + 1);
  }, 60_000);

  it("dimension: an UPDATE (the inspector's EditDimension ≡ the AI's update) lands identically; an ADD identically modulo the id (GAP: useDimensionTool.ts:28 salted vs dim-ai-*); a REMOVE lands identically but under two command ids — GAP: the editor's Delete runs pcb.delete-item (editor-adapter.ts:946-948), the AI runs pcb.dimension (execution-operations.ts:463)", async () => {
    const p = await pair(annotatedBoard());
    const update = await commitPcbCandidate(p.ui.history, { commandId: "pcb.dimension", label: "Change dimension offset", buildCandidate: (board) => produce(board, (draft) => mutateBoardWithDimensionCommand(draft, { kind: "EditDimension", id: "dim-width", patch: { offsetNm: -mmToNm(4) } })) });
    expect(update).toMatchObject({ ok: true, status: "executed" });
    await aiCommit(p.ai, DIMENSION_TOOL, { edits: [{ ...NULLS_DIM, op: "update", dimensionId: "dim-width", offsetNm: -mmToNm(4) }] }, "Move the width dimension line 1 mm further out.");
    expectSameEffect(p, p.start);
    // ADD modulo the id.
    const afterUpdate = mark(p.ui);
    const dimension = newBoardDimension({ id: "dim-ui-1", kind: "horizontal", a: { x: mmToNm(5), y: mmToNm(20) }, b: { x: mmToNm(15), y: mmToNm(20) }, offsetNm: mmToNm(2), ...DIMENSION_DEFAULTS });
    const added = await commitPcbCandidate(p.ui.history, { commandId: "pcb.dimension", label: "Add dimension", buildCandidate: (board) => produce(board, (draft) => mutateBoardWithDimensionCommand(draft, { kind: "AddDimension", item: dimension })) });
    expect(added).toMatchObject({ ok: true, status: "executed" });
    const { grant } = await aiCommit(p.ai, DIMENSION_TOOL, { edits: [{ ...NULLS_DIM, op: "add", kind: "horizontal", a: { x: mmToNm(5), y: mmToNm(20) }, b: { x: mmToNm(15), y: mmToNm(20) }, offsetNm: mmToNm(2) }] }, "Add a horizontal dimension from 5,20 to 15,20 mm with a 2 mm offset.");
    const pinned = grant.binding.proposal.operations[0]!;
    if (pinned.kind !== "add_dimension") throw new Error("unreachable");
    expect(pinned.dimension.id).toMatch(/^dim-ai-[0-9a-f]{16}$/);
    expect(digestOf(p.ai), "GAP pinned: the raw digests differ by the id alone").not.toBe(digestOf(p.ui));
    expect(digestModuloNewIds(p.ai.history.committedPresent)).toBe(digestModuloNewIds(p.ui.history.committedPresent));
    expect(headOf(p.ui).headSequence).toBe(afterUpdate.head + 1);
    // REMOVE: identical board, two command ids.
    const afterAdd = headOf(p.ui).headSequence;
    await uiCommit(p.ui, [{ op: "delete-items", refs: [{ kind: "dimension", id: "dim-width" }] }]);
    await aiCommit(p.ai, DIMENSION_TOOL, { edits: [{ ...NULLS_DIM, op: "remove", dimensionId: "dim-width" }] }, "Remove the width dimension.");
    expect(digestModuloNewIds(p.ai.history.committedPresent)).toBe(digestModuloNewIds(p.ui.history.committedPresent));
    expect(p.ui.history.committedPresent.dimensions?.some((item) => item.id === "dim-width")).toBe(false);
    expect(headOf(p.ui).headSequence).toBe(afterAdd + 1);
    expect(headOf(p.ai).headSequence).toBe(afterAdd + 1);
    expect(lastExecutedCommandOf(p.ui), "GAP pinned: the editor's Delete key is a destructive-tier command").toBe("pcb.delete-item");
    expect(lastExecutedCommandOf(p.ai), "GAP pinned: the AI's remove is the reversible dimension family").toBe("pcb.dimension");
  }, 60_000);

  it("undo-redo-granted: the editor's own Undo / Redo (canonical-aware wrapped history) and the AI's granted undo / redo each record a NEW pcb.undo-redo-canonical transaction and land the identical board", async () => {
    const p = await pair();
    const r3 = footprintOf(p.ui, "R3");
    const target = { x: r3.at.x + mmToNm(2), y: r3.at.y };
    await uiCommit(p.ui, [{ op: "set-position", ref: footprintRef(r3.id), atNm: target }]);
    await aiCommit(p.ai, MOVE_TOOL, { moves: [{ footprintId: r3.id, x: target.x, y: target.y }] }, "Move R3 2 mm to the right.");
    const moved = mark(p.ui);
    expectSameEffect(p, p.start);
    // UNDO
    p.ui.history.undo();
    await p.ui.session.whenIdle();
    await aiCommit(p.ai, UNDO_TOOL, { direction: "undo" }, "Could you undo that?");
    expect(digestOf(p.ui)).toBe(p.start.digest);
    expect(digestOf(p.ai)).toBe(p.start.digest);
    expect(headOf(p.ui).headSequence).toBe(p.start.head + 2);
    expect(headOf(p.ai).headSequence).toBe(p.start.head + 2);
    expect(p.ui.session.events.at(-1)).toMatchObject({ kind: "undo-reconciled" });
    expect(lastExecutedCommandOf(p.ai)).toBe(REPLAY_COMMAND_ID);
    expect(p.ai.history.entries.at(-1)).toMatchObject({ state: "applied", metadata: { actor: "ai" } }); // a NEW entry, never a stack pop
    // REDO
    p.ui.history.redo();
    await p.ui.session.whenIdle();
    await aiCommit(p.ai, UNDO_TOOL, { direction: "redo" }, "Could you redo that?");
    expect(digestOf(p.ui)).toBe(moved.digest);
    expect(digestOf(p.ai)).toBe(moved.digest);
    expect(headOf(p.ui).headSequence).toBe(p.start.head + 3);
    expect(headOf(p.ai).headSequence).toBe(p.start.head + 3);
    expect(p.ui.session.events.at(-1)).toMatchObject({ kind: "redo-reconciled" });
    expect(lastExecutedCommandOf(p.ai)).toBe(REPLAY_COMMAND_ID);
  }, 60_000);
});

interface RefusalCase {
  label: string;
  ui: EditCommand;
  /** What the editor's shared validator (validate.ts) says — plain English, no code. */
  uiError: RegExp;
  tool: string;
  args: Record<string, unknown>;
  plan: ExecutionPlan;
  /** The AI builder's closed refusal code (execution-operations.ts BuildRefusal). */
  aiCode: BuildRefusal["code"];
}

describe("PR-D parity (a) — equal validation refusal through the shared authority", () => {
  it("the same invalid input refuses on both paths with nothing committed — locked target, unknown id, too few items, empty text — the editor's validator string and the AI's closed code pinned side by side (GAP: two refusal vocabularies for one shared gate)", async () => {
    const board = annotatedBoard();
    board.footprints.find((f) => f.ref === "R4")!.locked = true;
    const c = await composeFrom(board);
    const live = c.history.committedPresent;
    const r3 = footprintOf(c, "R3");
    const r4 = footprintOf(c, "R4");
    const cases: RefusalCase[] = [
      { label: "move / locked", ui: { op: "set-position", ref: footprintRef(r4.id), atNm: { x: r4.at.x + mmToNm(1), y: r4.at.y } }, uiError: /R4 is locked/, tool: MOVE_TOOL, args: { moves: [{ footprintId: r4.id, x: r4.at.x + mmToNm(1), y: r4.at.y }] }, plan: { family: "pcb.move-footprint", moves: [{ footprintId: r4.id, x: r4.at.x + mmToNm(1), y: r4.at.y }] }, aiCode: "locked_target" },
      { label: "move / unknown id", ui: { op: "set-position", ref: footprintRef("fp-nope"), atNm: { x: 0, y: 0 } }, uiError: /No footprint fp-nope/, tool: MOVE_TOOL, args: { moves: [{ footprintId: "fp-nope", x: 0, y: 0 }] }, plan: { family: "pcb.move-footprint", moves: [{ footprintId: "fp-nope", x: 0, y: 0 }] }, aiCode: "unknown_target" },
      { label: "rotate / locked", ui: { op: "set-footprint-props", id: r4.id, patch: { rotationDeg: 90 } }, uiError: /R4 is locked/, tool: ROTATE_TOOL, args: { targets: [{ footprintId: r4.id, rotationDeg: 90, side: null }] }, plan: { family: "pcb.rotate-side-footprint", targets: [{ footprintId: r4.id, rotationDeg: 90, side: r4.side }] }, aiCode: "locked_target" },
      { label: "rotate / unknown id", ui: { op: "set-footprint-props", id: "fp-nope", patch: { rotationDeg: 90 } }, uiError: /No footprint fp-nope/, tool: ROTATE_TOOL, args: { targets: [{ footprintId: "fp-nope", rotationDeg: 90, side: "top" }] }, plan: { family: "pcb.rotate-side-footprint", targets: [{ footprintId: "fp-nope", rotationDeg: 90, side: "top" }] }, aiCode: "unknown_target" },
      { label: "arrange / one item", ui: { op: "align", refs: [footprintRef(r3.id)], mode: "left" }, uiError: /at least two items/, tool: ARRANGE_TOOL, args: { mode: "align", footprintIds: [r3.id], edge: "left", axis: null, gridNm: null }, plan: { family: "pcb.arrange", mode: "align", footprintIds: [r3.id], edge: "left" }, aiCode: "compile_failed" },
      { label: "arrange / locked", ui: { op: "align", refs: [footprintRef(r3.id), footprintRef(r4.id)], mode: "left" }, uiError: /R4 is locked/, tool: ARRANGE_TOOL, args: { mode: "align", footprintIds: [r3.id, r4.id], edge: "left", axis: null, gridNm: null }, plan: { family: "pcb.arrange", mode: "align", footprintIds: [r3.id, r4.id], edge: "left" }, aiCode: "locked_target" },
      { label: "silk / unknown id", ui: { op: "set-text-props", id: "silk-nope", patch: { text: "X" } }, uiError: /No text silk-nope/, tool: SILK_TOOL, args: { edits: [{ ...NULLS_SILK, op: "update", silkId: "silk-nope", text: "X" }] }, plan: { family: "pcb.silkscreen-text", edits: [{ op: "update", silkId: "silk-nope", text: "X" }] }, aiCode: "unknown_target" },
      { label: "silk / empty text", ui: { op: "set-text-props", id: "silk-rev", patch: { text: "" } }, uiError: /can't be empty/, tool: SILK_TOOL, args: { edits: [{ ...NULLS_SILK, op: "update", silkId: "silk-rev", text: "" }] }, plan: { family: "pcb.silkscreen-text", edits: [{ op: "update", silkId: "silk-rev", text: "" }] }, aiCode: "invalid_geometry" },
      { label: "dimension / unknown id", ui: { op: "delete-items", refs: [{ kind: "dimension", id: "dim-nope" }] }, uiError: /No dimension dim-nope/, tool: DIMENSION_TOOL, args: { edits: [{ ...NULLS_DIM, op: "remove", dimensionId: "dim-nope" }] }, plan: { family: "pcb.dimension", edits: [{ op: "remove", dimensionId: "dim-nope" }] }, aiCode: "unknown_target" },
    ];
    const start = mark(c);
    const m = spyMinter(c);
    const gateway = gatewayFor(c, m.minter);
    const context = runContext(c);
    const seen: Array<{ label: string; ui: string; ai: string }> = [];
    for (const [index, item] of cases.entries()) {
      // UI: the shared validator refuses; the canonical funnel refuses with zero mutation.
      const compiled = compileEdits(live, [item.ui]);
      expect(compiled.errors.length, `${item.label}: the shared validator`).toBeGreaterThan(0);
      expect(compiled.errors[0], item.label).toMatch(item.uiError);
      const applied = await applyEditsCanonical(c.history, [item.ui]);
      expect(applied.ok, item.label).toBe(false);
      expect(applied.errors[0], item.label).toMatch(item.uiError);
      // AI: the shared builder refuses with its closed code; the gateway seals nothing and the minter is never asked.
      const built = buildExecutionOperations(live, item.plan);
      expect(built.ok, item.label).toBe(false);
      if (built.ok) continue;
      expect(built.code, item.label).toBe(item.aiCode);
      const outcome = await invokeTool(c, gateway, item.tool, item.args, `call-${index}`, context);
      expect(outcome, item.label).toMatchObject({ kind: "refused", ok: false, status: "invalid_input", diagnostics: [built.message] });
      if (item.aiCode === "compile_failed") expect(built.message, `${item.label}: the AI relays the editor's own validator string`).toMatch(item.uiError);
      seen.push({ label: item.label, ui: compiled.errors[0]!, ai: `${built.code}: ${built.message}` });
    }
    expect(m.calls()).toBe(0);
    expect(mark(c)).toEqual(start);
    expect(seen.length).toBe(cases.length);
  }, 60_000);

  it("an out-of-board move is PERMITTED on both paths — neither the editor's validator nor the AI builder checks the outline (DRC reports it); equal acceptance, not a refusal", async () => {
    const board = annotatedBoard();
    const r3 = board.footprints.find((f) => f.ref === "R3")!;
    const outside = { x: mmToNm(400), y: mmToNm(400) };
    expect(compileEdits(board, [{ op: "set-position", ref: footprintRef(r3.id), atNm: outside }]).errors).toEqual([]);
    const built = buildExecutionOperations(board, { family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: outside.x, y: outside.y }] });
    expect(built.ok).toBe(true);
  });

  it("GAP: the AI builder is stricter than the editor's validator — fractional nanometres and an out-of-range rotation are accepted and normalized by the editor (apply.ts roundVec / mod 360) but refused by the AI as invalid_geometry", async () => {
    const board = annotatedBoard();
    const r3 = board.footprints.find((f) => f.ref === "R3")!;
    const fractional = { x: r3.at.x + 1_000_000.5, y: r3.at.y };
    const uiFractional = compileEdits(board, [{ op: "set-position", ref: footprintRef(r3.id), atNm: fractional }]);
    expect(uiFractional.errors).toEqual([]);
    expect(uiFractional.result.footprints.find((f) => f.id === r3.id)!.at.x).toBe(Math.round(fractional.x));
    expect(buildExecutionOperations(board, { family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: fractional.x, y: fractional.y }] })).toMatchObject({ ok: false, code: "invalid_geometry" });
    const uiRotation = compileEdits(board, [{ op: "set-footprint-props", id: r3.id, patch: { rotationDeg: 450 } }]);
    expect(uiRotation.errors).toEqual([]);
    expect(uiRotation.result.footprints.find((f) => f.id === r3.id)!.rotationDeg).toBe(90);
    expect(buildExecutionOperations(board, { family: "pcb.rotate-side-footprint", targets: [{ footprintId: r3.id, rotationDeg: 450, side: r3.side }] })).toMatchObject({ ok: false, code: "invalid_geometry" });
  });

  it("every AI-built plan is inside the editor's own gate: the builder's edit commands compile through the shared validator with zero errors (the AI can never do what the editor's validator refuses)", () => {
    const board = annotatedBoard();
    const [r3, r4] = ["R3", "R4"].map((ref) => board.footprints.find((f) => f.ref === ref)!);
    const plans: ExecutionPlan[] = [
      { family: "pcb.move-footprint", moves: [{ footprintId: r3!.id, x: r3!.at.x + mmToNm(1), y: r3!.at.y }] },
      { family: "pcb.rotate-side-footprint", targets: [{ footprintId: r3!.id, rotationDeg: 270, side: "bottom" }] },
      { family: "pcb.arrange", mode: "align", footprintIds: [r3!.id, r4!.id], edge: "top" },
      { family: "pcb.arrange", mode: "snap-to-grid", footprintIds: [r3!.id, r4!.id], gridNm: mmToNm(2.5) },
      { family: "pcb.silkscreen-text", edits: [{ op: "update", silkId: "silk-rev", text: "REV C", heightNm: 1_200_000 }] },
    ];
    for (const plan of plans) {
      const built = buildExecutionOperations(board, plan);
      if (!built.ok) throw new Error(`${plan.family}: ${built.message}`);
      expect(built.commands.length, plan.family).toBeGreaterThan(0);
      expect(compileEdits(board, built.commands).errors, plan.family).toEqual([]);
    }
  });
});
