/**
 * [B18-B] ONE pure operation builder per execution family — the SAME
 * compilers the interactive editor session uses (`compileEdits` → the exact
 * mutator semantics and validation; `compilePcbBoardDelta` → the canonical
 * operations with deterministic ids), so an agent plan, the explicit-request
 * grammar's derivation and the browser's recompile at commit time all produce
 * byte-identical operations for the same intent against the same board.
 *
 * [B18-C I5] Three families: absolute footprint moves; absolute rotation and
 * board side (`set-footprint-props`); and arrange (align / distribute /
 * snap-to-grid). `planFromOperations` is the ONE inverse — a grant's
 * operations back to the plan that rebuilds them byte for byte — shared by the
 * browser recompile (and pinned against the seal and the grammar). An arrange
 * grant is rebuilt as the absolute positions its parameters produced: the
 * parameters are the MODEL's words, the grant pins their result, and the
 * browser never re-runs the arrangement against a possibly drifted board.
 * [B18-C I6/I7] Silkscreen text and dimension annotations: add / update /
 * remove through the editor's own silk and dimension commands, deterministic
 * add ids, and a pinned inverse (the grant's exact resulting items).
 *
 * No parallel mutation code exists here: a plan is a list of edit commands.
 */
import { produce } from "immer";
import { compileEdits } from "../pcb/edit/apply";
import { mutateBoardWithSilkCommand } from "../pcb/silk/commands";
import { mutateBoardWithDimensionCommand, newBoardDimension, type DimensionPatch } from "../pcb/dimensions/commands";
import { formatDimensionValue } from "../pcb/dimensions/geometry";
import type { SilkLayer, SilkTextItem } from "../pcb/silk/types";
import { pcbRevisionId } from "../pcb/revision";
import type { EditCommand, SelectionRef } from "../pcb/edit/commands";
import type { BoardDimension, DimensionKind, DimensionLayer, PcbBoard } from "../pcb/types";
import { nmToMm } from "../pcb/units";
import { compilePcbBoardDelta } from "./pcb-delta";
import { executionOperationsDigest, executionPreviewDigest, executionTargetsDigest, MAX_GRANT_OPERATIONS, type ExecutionFamily, type ExecutionGrantPreview, type ExecutionGrantTargets } from "./execution-grant";
import { applyEngineeringOperations } from "./operations";
import { validateBoardDimension } from "./pcb-board-structure";
import { canonicalLineageDigest } from "./semantic-board-digest";
import { engineeringDigest } from "./stable";
import { STAGE10_SCHEMA_VERSION, type EngineeringOperation } from "./types";

/** A move plan: absolute integer-nm targets per footprint (the tool's argument shape). */
export interface MoveFootprintPlan { family: "pcb.move-footprint"; moves: Array<{ footprintId: string; x: number; y: number }> }
/** [B18-C I5] Absolute rotation (whole degrees, counter-clockwise as seen on screen, 0–359) AND board side per footprint —
 *  both always present (the seal fills an omitted field from the verified board), so the plan is its own canonical form. */
export interface RotateSidePlan { family: "pcb.rotate-side-footprint"; targets: Array<{ footprintId: string; rotationDeg: number; side: "top" | "bottom" }> }
export const ARRANGE_EDGES = Object.freeze(["left", "right", "top", "bottom", "centerH", "centerV"] as const);
export type ArrangeEdge = (typeof ARRANGE_EDGES)[number];
/** [B18-C I5] Arrange as the MODEL states it (the parameters) — or as a grant pins it (`positions`: the absolute positions those
 *  parameters produced; only `planFromOperations` produces this form, never a tool argument). */
export type ArrangePlan =
  | { family: "pcb.arrange"; mode: "align"; footprintIds: string[]; edge: ArrangeEdge }
  | { family: "pcb.arrange"; mode: "distribute"; footprintIds: string[]; axis: "h" | "v" }
  | { family: "pcb.arrange"; mode: "snap-to-grid"; footprintIds: string[]; gridNm: number }
  | { family: "pcb.arrange"; mode: "positions"; moves: Array<{ footprintId: string; x: number; y: number }> };
/** [B18-C I6] Silkscreen TEXT edits as the model states them. An `add` receives a DETERMINISTIC id derived from the base
 *  revision, its index among the plan's adds and its content (the editor's own silk ids are salted counters, which a
 *  byte-for-byte recompile could never reproduce). */
export type SilkTextEdit =
  | { op: "add"; text: string; layer: SilkLayer; atNm: { x: number; y: number }; heightNm: number; strokeWidthNm: number }
  | { op: "update"; silkId: string; text?: string; heightNm?: number; strokeWidthNm?: number; layer?: SilkLayer }
  | { op: "remove"; silkId: string };
/** [B18-C I6] …or as a grant pins them (only `planFromOperations` produces this form): the exact resulting items. */
export type SilkTextChange = { op: "add"; item: SilkTextItem } | { op: "replace"; item: SilkTextItem } | { op: "remove"; silkId: string };
export type SilkTextPlan = { family: "pcb.silkscreen-text"; edits: SilkTextEdit[] } | { family: "pcb.silkscreen-text"; mode: "pinned"; changes: SilkTextChange[] };
/** [B18-C I7] Dimension annotations as the model states them. An `add` receives a DETERMINISTIC id (base revision + index +
 *  content), like an AI silk text; an `update` changes only what the dimension inspector edits — never the measured points. */
export type DimensionEdit =
  | { op: "add"; kind: DimensionKind; a: { x: number; y: number }; b: { x: number; y: number }; offsetNm: number; layer: DimensionLayer; unit: BoardDimension["unit"]; precision: BoardDimension["precision"]; textHeightNm: number; strokeWidthNm: number }
  | ({ op: "update"; dimensionId: string } & DimensionPatch)
  | { op: "remove"; dimensionId: string };
/** [B18-C I7] …or as a grant pins them (only `planFromOperations` produces this form): the exact resulting items. */
export type DimensionChange = { op: "add"; item: BoardDimension } | { op: "replace"; item: BoardDimension } | { op: "remove"; dimensionId: string };
export type DimensionPlan = { family: "pcb.dimension"; edits: DimensionEdit[] } | { family: "pcb.dimension"; mode: "pinned"; changes: DimensionChange[] };
export type ExecutionPlan = MoveFootprintPlan | RotateSidePlan | ArrangePlan | SilkTextPlan | DimensionPlan;

export const SILK_TEXT_MAX_CHARS = 64;
/** The editor's own silk tool never places text shorter than 0.1 mm (useSilkTool). */
export const SILK_TEXT_MIN_HEIGHT_NM = 100_000;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;
const SILK_LAYERS: readonly SilkLayer[] = Object.freeze(["silkTop", "silkBottom"]);
const SILK_KINDS = Object.freeze(["add_silk", "update_silk", "remove_silk"] as const);
const PLACEMENT_KINDS = Object.freeze(["move_footprint"] as const);
const DIMENSION_OPERATION_KINDS = Object.freeze(["add_dimension", "update_dimension", "remove_dimension"] as const);
const DIMENSION_PATCH_KEYS = Object.freeze(["kind", "offsetNm", "layer", "unit", "precision", "textHeightNm", "strokeWidthNm"] as const);

/** [B18-C I6] The deterministic id of an AI-added silk text: base revision + index + content (never a salted counter). */
export function aiSilkTextId(board: PcbBoard, index: number, body: Omit<SilkTextItem, "id">): string {
  return `silk-ai-${engineeringDigest({ schema: "sirkit.agent-silk-id.v1", base: pcbRevisionId(board), index, item: body }).slice(5, 21)}`;
}

/** [B18-C I7] The deterministic id of an AI-added dimension: base revision + index + content (never the tool's salted counter). */
export function aiDimensionId(board: PcbBoard, index: number, body: Omit<BoardDimension, "id">): string {
  return `dim-ai-${engineeringDigest({ schema: "sirkit.agent-dimension-id.v1", base: pcbRevisionId(board), index, item: body }).slice(5, 21)}`;
}

export interface BuiltExecution {
  ok: true;
  family: ExecutionFamily;
  operations: EngineeringOperation[];
  operationsDigest: string;
  targets: ExecutionGrantTargets;
  preview: ExecutionGrantPreview;
  previewDigest: string;
  /** The edit commands the operations were compiled from (the browser recompiles the same commands). */
  commands: EditCommand[];
  /** The PCB revision of the board AFTER the operations, as the canonical KERNEL produces it (the kernel re-marks every
   *  zone fill dirty from the operation id on a move, so only its own applier predicts the committed board) — the grant
   *  pins it as the exact expected result. */
  resultRevision: string;
  /** [B18-C review] the fill-normalized semantic digest of that result — what the ritual's postcondition compares (zone
   *  refills may land in the editor between the commit and the check; derived fill state never decides "it landed"). */
  resultLineageDigest: string;
}
export interface BuildRefusal { ok: false; code: "empty" | "too_many" | "unknown_target" | "locked_target" | "invalid_geometry" | "compile_failed" | "no_change" | "unsupported_family"; message: string }

const fmt = (nm: number): string => nmToMm(nm).toFixed(3);
const refusal = (code: BuildRefusal["code"], message: string): BuildRefusal => ({ ok: false, code, message });
const footprintRef = (id: string): SelectionRef => ({ kind: "footprint", id });

/** The shared tail: the editor's own mutators compile the commands, the canonical delta derives the operations, the KERNEL
 *  predicts the committed result, and every digest is taken over exactly that. */
function finish(board: PcbBoard, family: ExecutionFamily, commands: EditCommand[], objectIds: readonly string[], before: string[], after: string[], noChange: string): BuiltExecution | BuildRefusal {
  const compiled = compileEdits(board, commands);
  if (compiled.errors.length > 0) return refusal("compile_failed", compiled.errors[0]!);
  return finishCandidate(board, family, compiled.result, commands, objectIds, before, after, noChange, PLACEMENT_KINDS, ["footprint"], compiled.diagnostics.map((diagnostic) => diagnostic.summary));
}

/** [B18-C I6] The tail over an already-built candidate board (the silk commands mutate a candidate directly). */
function finishCandidate(board: PcbBoard, family: ExecutionFamily, candidate: PcbBoard, commands: EditCommand[], objectIds: readonly string[], before: string[], after: string[], noChange: string, kinds: readonly string[], targetKinds: ExecutionGrantTargets["kinds"], warnings: string[], describe?: (operations: readonly EngineeringOperation[]) => { before: string[]; after: string[] }): BuiltExecution | BuildRefusal {
  const delta = compilePcbBoardDelta(board, candidate, family);
  const operations = delta.operations.filter((operation) => kinds.includes(operation.kind));
  // [B18-C I6] a describer reads the preview off the canonical operations themselves (their delta order), so the seal and a
  // pinned recompile — which replays the operations, not the model's edit order — describe the identical change.
  if (describe) ({ before, after } = describe(operations));
  if (operations.length === 0) return refusal("no_change", noChange);
  if (operations.length !== delta.operations.length) return refusal("compile_failed", `The plan compiled to operations outside the ${family.replace(/^pcb\./, "")} family.`);
  // [B18-C review V0] the expected result is what the canonical KERNEL commits from these exact operations — not the
  // editor mutator's board. A kernel refusal here refuses the plan before any grant exists.
  let predicted: PcbBoard;
  try {
    predicted = applyEngineeringOperations({ schemaVersion: STAGE10_SCHEMA_VERSION, tenantId: "", projectId: "", branchId: "", pcb: board, pinnedAssets: [] }, operations).project.pcb;
  } catch (error) {
    return refusal("compile_failed", `The canonical kernel refuses the plan: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
  }
  const targets: ExecutionGrantTargets = { resolvedFrom: "named", objectIds: [...objectIds].sort(), netIds: [], kinds: [...targetKinds], selectionDigest: null, targetsDigest: "" };
  targets.targetsDigest = executionTargetsDigest(targets);
  const preview: ExecutionGrantPreview = { before: before.join("; "), after: after.join("; "), warnings: warnings.slice(0, 8) };
  const operationsDigest = executionOperationsDigest(family, operations);
  return { ok: true, family, operations, operationsDigest, targets, preview, previewDigest: executionPreviewDigest({ operationsDigest, targetsDigest: targets.targetsDigest, preview }), commands, resultRevision: pcbRevisionId(predicted), resultLineageDigest: canonicalLineageDigest(predicted) };
}

/** Absolute positions (the move family, and an arrange grant's pinned form). */
function buildPositions(board: PcbBoard, family: "pcb.move-footprint" | "pcb.arrange", moves: MoveFootprintPlan["moves"]): BuiltExecution | BuildRefusal {
  if (!Array.isArray(moves) || moves.length === 0) return refusal("empty", "The plan names no footprint to move.");
  if (moves.length > MAX_GRANT_OPERATIONS) return refusal("too_many", `A grant covers at most ${MAX_GRANT_OPERATIONS} operations.`);
  const commands: EditCommand[] = [];
  const before: string[] = [];
  const after: string[] = [];
  const seen = new Set<string>();
  for (const move of moves) {
    if (typeof move.footprintId !== "string" || move.footprintId.length === 0 || seen.has(move.footprintId)) return refusal("unknown_target", "Each move must name one distinct footprint id.");
    seen.add(move.footprintId);
    const footprint = board.footprints.find((item) => item.id === move.footprintId);
    if (!footprint) return refusal("unknown_target", `Footprint ${move.footprintId} is not on this board.`);
    if (footprint.locked) return refusal("locked_target", `Footprint ${footprint.ref} is locked; a locked footprint is never moved by an agent.`);
    if (!Number.isSafeInteger(move.x) || !Number.isSafeInteger(move.y)) return refusal("invalid_geometry", "Targets must be integer nanometres.");
    commands.push({ op: "set-position", ref: footprintRef(footprint.id), atNm: { x: move.x, y: move.y } });
    before.push(`${footprint.ref} at (${fmt(footprint.at.x)}, ${fmt(footprint.at.y)}) mm`);
    after.push(`${footprint.ref} at (${fmt(move.x)}, ${fmt(move.y)}) mm`);
  }
  return finish(board, family, commands, [...seen], before, after, "The plan changes nothing (every footprint is already at its target).");
}

/** [B18-C I5] Absolute rotation / board side through `set-footprint-props`; the preview names only the fields that change. */
function buildRotateSide(board: PcbBoard, plan: RotateSidePlan): BuiltExecution | BuildRefusal {
  const targets = plan.targets;
  if (!Array.isArray(targets) || targets.length === 0) return refusal("empty", "The plan names no footprint to rotate or flip.");
  if (targets.length > MAX_GRANT_OPERATIONS) return refusal("too_many", `A grant covers at most ${MAX_GRANT_OPERATIONS} operations.`);
  const commands: EditCommand[] = [];
  const before: string[] = [];
  const after: string[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    if (typeof target.footprintId !== "string" || target.footprintId.length === 0 || seen.has(target.footprintId)) return refusal("unknown_target", "Each target must name one distinct footprint id.");
    seen.add(target.footprintId);
    const footprint = board.footprints.find((item) => item.id === target.footprintId);
    if (!footprint) return refusal("unknown_target", `Footprint ${target.footprintId} is not on this board.`);
    if (footprint.locked) return refusal("locked_target", `Footprint ${footprint.ref} is locked; a locked footprint is never rotated or flipped by an agent.`);
    if (!Number.isSafeInteger(target.rotationDeg) || target.rotationDeg < 0 || target.rotationDeg > 359) return refusal("invalid_geometry", "Rotation must be a whole number of degrees from 0 to 359.");
    if (target.side !== "top" && target.side !== "bottom") return refusal("invalid_geometry", "Side must be top or bottom.");
    const patch: { rotationDeg?: number; side?: "top" | "bottom" } = {};
    const was: string[] = [];
    const will: string[] = [];
    if (target.rotationDeg !== footprint.rotationDeg) { patch.rotationDeg = target.rotationDeg; was.push(`rotation ${footprint.rotationDeg}°`); will.push(`rotation ${target.rotationDeg}°`); }
    if (target.side !== footprint.side) { patch.side = target.side; was.push(`side ${footprint.side}`); will.push(`side ${target.side}`); }
    if (was.length === 0) continue;
    commands.push({ op: "set-footprint-props", id: footprint.id, patch });
    before.push(`${footprint.ref} ${was.join(", ")}`);
    after.push(`${footprint.ref} ${will.join(", ")}`);
  }
  if (commands.length === 0) return refusal("no_change", "The plan changes nothing (every footprint already has that rotation and side).");
  return finish(board, plan.family, commands, [...seen].filter((id) => commands.some((command) => command.op === "set-footprint-props" && command.id === id)), before, after, "The plan changes nothing (every footprint already has that rotation and side).");
}

/** [B18-C I5] Arrange: the editor's own align / distribute / snap-to-grid compute the new positions; the grant is built (and
 *  later recompiled) as exactly those absolute positions. */
function buildArrange(board: PcbBoard, plan: ArrangePlan): BuiltExecution | BuildRefusal {
  if (plan.mode === "positions") return buildPositions(board, "pcb.arrange", plan.moves);
  const ids = plan.footprintIds;
  if (!Array.isArray(ids) || ids.length === 0) return refusal("empty", "The plan names no footprint to arrange.");
  if (ids.length > MAX_GRANT_OPERATIONS) return refusal("too_many", `A grant covers at most ${MAX_GRANT_OPERATIONS} operations.`);
  if (new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string" || id.length === 0)) return refusal("unknown_target", "Each footprint must be named once by its stable id.");
  for (const id of ids) {
    const footprint = board.footprints.find((item) => item.id === id);
    if (!footprint) return refusal("unknown_target", `Footprint ${id} is not on this board.`);
    if (footprint.locked) return refusal("locked_target", `Footprint ${footprint.ref} is locked; a locked footprint is never moved by an agent.`);
  }
  const refs = ids.map(footprintRef);
  let command: EditCommand;
  if (plan.mode === "align") command = { op: "align", refs, mode: plan.edge };
  else if (plan.mode === "distribute") command = { op: "distribute", refs, axis: plan.axis };
  else {
    if (!Number.isSafeInteger(plan.gridNm) || plan.gridNm <= 0) return refusal("invalid_geometry", "The snap grid must be a positive whole number of nanometres.");
    command = { op: "snap-to-grid", refs, gridNm: plan.gridNm };
  }
  const arranged = compileEdits(board, [command]);
  if (arranged.errors.length > 0) return refusal("compile_failed", arranged.errors[0]!);
  const moves: MoveFootprintPlan["moves"] = [];
  for (const id of ids) {
    const was = board.footprints.find((item) => item.id === id)!;
    const now = arranged.result.footprints.find((item) => item.id === id);
    if (!now) return refusal("compile_failed", `The arrangement removed footprint ${was.ref}.`);
    if (now.rotationDeg !== was.rotationDeg || now.side !== was.side) return refusal("compile_failed", `The arrangement changed ${was.ref} beyond its position.`);
    if (now.at.x !== was.at.x || now.at.y !== was.at.y) moves.push({ footprintId: id, x: now.at.x, y: now.at.y });
  }
  if (moves.length === 0) return refusal("no_change", "The arrangement changes nothing (the footprints are already arranged that way).");
  return buildPositions(board, "pcb.arrange", moves);
}

const silkTextOf = (board: PcbBoard, id: string): SilkTextItem | null => {
  const item = (board.silkItems ?? []).find((candidate) => candidate.id === id);
  return item && item.kind === "text" ? item : null;
};
const describeSilk = (item: SilkTextItem): string => `silk text "${item.text}" at (${fmt(item.position.x)}, ${fmt(item.position.y)}) mm on ${item.layer === "silkBottom" ? "bottom" : "top"}, ${fmt(item.heightNm)} mm high`;
function silkTextProblem(text: unknown): string | null {
  if (typeof text !== "string" || text.length === 0) return "Silk text can't be empty.";
  if (text.length > SILK_TEXT_MAX_CHARS) return `Silk text is at most ${SILK_TEXT_MAX_CHARS} characters.`;
  if (!PRINTABLE_ASCII.test(text)) return "Silk text must be printable ASCII (the silkscreen font has no other glyphs).";
  return null;
}
function silkSizeProblem(heightNm: unknown, strokeWidthNm: unknown): string | null {
  if (heightNm !== undefined && (typeof heightNm !== "number" || !Number.isSafeInteger(heightNm) || heightNm < SILK_TEXT_MIN_HEIGHT_NM)) return "Silk text height must be whole nanometres, at least 0.1 mm.";
  if (strokeWidthNm !== undefined && (typeof strokeWidthNm !== "number" || !Number.isSafeInteger(strokeWidthNm) || strokeWidthNm <= 0)) return "Silk text stroke must be a positive whole number of nanometres.";
  return null;
}

/** [B18-C I6] Silkscreen TEXT: adds and removes with the editor's own silk commands, updates with its own `set-text-props`
 *  mutator (validation included); the candidate board's canonical delta gives the operations (never `*_text`: board text is
 *  not silk and is out of scope). A pinned plan replays the grant's exact resulting items. */
function buildSilkText(board: PcbBoard, plan: SilkTextPlan): BuiltExecution | BuildRefusal {
  const changes: SilkTextChange[] = [];
  const commands: EditCommand[] = [];
  if ("mode" in plan) {
    if (!Array.isArray(plan.changes) || plan.changes.length === 0) return refusal("empty", "The plan names no silkscreen text change.");
    changes.push(...plan.changes);
  } else {
    const edits = plan.edits;
    if (!Array.isArray(edits) || edits.length === 0) return refusal("empty", "The plan names no silkscreen text edit.");
    if (edits.length > MAX_GRANT_OPERATIONS) return refusal("too_many", `A grant covers at most ${MAX_GRANT_OPERATIONS} operations.`);
    let addIndex = 0;
    for (const edit of edits) {
      if (edit.op === "add") {
        const problem = silkTextProblem(edit.text) ?? silkSizeProblem(edit.heightNm, edit.strokeWidthNm);
        if (problem) return refusal("invalid_geometry", problem);
        if (!SILK_LAYERS.includes(edit.layer)) return refusal("invalid_geometry", "Silk text can only sit on a silkscreen layer (silkTop or silkBottom).");
        if (!Number.isSafeInteger(edit.atNm?.x) || !Number.isSafeInteger(edit.atNm?.y)) return refusal("invalid_geometry", "The text position must be integer nanometres.");
        // Derived fields follow the editor's own silk tool exactly: rotation 0, centred, mirrored on the bottom side.
        const body: Omit<SilkTextItem, "id"> = { kind: "text", layer: edit.layer, position: { x: edit.atNm.x, y: edit.atNm.y }, text: edit.text, heightNm: edit.heightNm, strokeWidthNm: edit.strokeWidthNm, rotationDeg: 0, mirror: edit.layer === "silkBottom", anchor: "center" };
        changes.push({ op: "add", item: { id: aiSilkTextId(board, addIndex, body), ...body } });
        addIndex += 1;
        continue;
      }
      const current = silkTextOf(board, edit.silkId);
      if (!current) return refusal("unknown_target", `Silk text ${String(edit.silkId).slice(0, 60)} is not on this board (only silkscreen TEXT items can be edited or removed).`);
      if (edit.op === "remove") { changes.push({ op: "remove", silkId: edit.silkId }); continue; }
      if (edit.text !== undefined) { const problem = silkTextProblem(edit.text); if (problem) return refusal("invalid_geometry", problem); }
      const sizeProblem = silkSizeProblem(edit.heightNm, edit.strokeWidthNm);
      if (sizeProblem) return refusal("invalid_geometry", sizeProblem);
      if (edit.layer !== undefined && !SILK_LAYERS.includes(edit.layer)) return refusal("invalid_geometry", "Silk text can only sit on a silkscreen layer (silkTop or silkBottom).");
      const patch = { ...(edit.text !== undefined ? { text: edit.text } : {}), ...(edit.heightNm !== undefined ? { sizeNm: edit.heightNm } : {}), ...(edit.strokeWidthNm !== undefined ? { thicknessNm: edit.strokeWidthNm } : {}), ...(edit.layer !== undefined ? { layer: edit.layer } : {}) };
      const command: EditCommand = { op: "set-text-props", id: edit.silkId, patch };
      const compiled = compileEdits(board, [command]);
      if (compiled.errors.length > 0) return refusal("compile_failed", compiled.errors[0]!);
      commands.push(command);
      changes.push({ op: "replace", item: silkTextOf(compiled.result, edit.silkId)! });
    }
  }
  // Validate every change against the base board (a pinned plan is re-checked here too), then build the candidate with the
  // editor's own silk commands.
  const touched = new Set<string>();
  for (const change of changes) {
    const id = change.op === "remove" ? change.silkId : change.item.id;
    if (typeof id !== "string" || id.length === 0 || touched.has(id)) return refusal("unknown_target", "Each silk text may appear once per plan.");
    touched.add(id);
    if (change.op === "add") {
      if ((board.silkItems ?? []).some((existing) => existing.id === id)) return refusal("unknown_target", `The derived silk id ${id} already exists on this board.`);
      if (change.item.kind !== "text") return refusal("unknown_target", "Only silkscreen TEXT items are in scope.");
    } else if (!silkTextOf(board, id)) {
      return refusal("unknown_target", `Silk text ${id.slice(0, 60)} is not on this board (only silkscreen TEXT items can be edited or removed).`);
    }
  }
  const candidate = produce(board, (draft) => {
    for (const change of changes) {
      if (change.op === "add") mutateBoardWithSilkCommand(draft, { kind: "AddSilk", item: change.item });
      else if (change.op === "replace") mutateBoardWithSilkCommand(draft, { kind: "EditSilk", id: change.item.id, before: silkTextOf(board, change.item.id)!, after: change.item });
      else mutateBoardWithSilkCommand(draft, { kind: "DeleteSilk", before: silkTextOf(board, change.silkId)! });
    }
  });
  const describe = (operations: readonly EngineeringOperation[]) => {
    const before: string[] = [];
    const after: string[] = [];
    for (const operation of operations) {
      if (operation.kind === "add_silk" && operation.item.kind === "text") { before.push("(new)"); after.push(describeSilk(operation.item)); }
      else if (operation.kind === "update_silk" && operation.replace.kind === "text") { before.push(describeSilk(silkTextOf(board, operation.silkId)!)); after.push(describeSilk(operation.replace)); }
      else if (operation.kind === "remove_silk") { before.push(describeSilk(silkTextOf(board, operation.silkId)!)); after.push("(removed)"); }
    }
    return { before, after };
  };
  return finishCandidate(board, plan.family, candidate, commands, [...touched], [], [], "The plan changes nothing (every silk text already reads that way).", SILK_KINDS, ["text"], [], describe);
}

const dimensionOf = (board: PcbBoard, id: string): BoardDimension | null => (board.dimensions ?? []).find((candidate) => candidate.id === id) ?? null;
const describeDimension = (item: BoardDimension): string => `${item.kind} dimension ${formatDimensionValue(item)} from (${fmt(item.a.x)}, ${fmt(item.a.y)}) to (${fmt(item.b.x)}, ${fmt(item.b.y)}) mm, offset ${fmt(item.offsetNm)} mm, on ${item.layer}`;
/** Everything an in-place edit may change (the id and the measured points never change in place). */
const dimensionStyleOf = (item: BoardDimension): DimensionPatch => ({ kind: item.kind, offsetNm: item.offsetNm, layer: item.layer, unit: item.unit, precision: item.precision, textHeightNm: item.textHeightNm, strokeWidthNm: item.strokeWidthNm });
const isDimensionShaped = (item: unknown): item is BoardDimension => {
  if (typeof item !== "object" || item === null) return false;
  const { a, b } = item as { a?: unknown; b?: unknown };
  return typeof a === "object" && a !== null && typeof b === "object" && b !== null;
};

/** The kernel's own rules (`validateBoardDimension`) plus two the editor keeps by construction: a NEW dimension line never sits
 *  on its measured span (the tool substitutes 2 mm for a zero offset — an AI plan is refused instead of silently changed), and a
 *  label height the plan sets is at least 0.1 mm (the inspector's input minimum). */
function dimensionProblem(item: BoardDimension, current: BoardDimension | null): string | null {
  if (!current && item.offsetNm === 0) return "A new dimension needs a non-zero offset (its line would sit on the measured span).";
  if ((!current || item.textHeightNm !== current.textHeightNm) && typeof item.textHeightNm === "number" && item.textHeightNm < SILK_TEXT_MIN_HEIGHT_NM) return "Dimension text height must be at least 0.1 mm.";
  const issues = validateBoardDimension(item);
  return issues.length > 0 ? `The dimension is invalid: ${issues[0]!.slice(`dimension ${item.id}: `.length)}.` : null;
}

/** [B18-C I7] Dimension annotations: every change goes through the editor's own dimension commands (the tool's add, the
 *  inspector's in-place edit, the Delete semantics); the candidate board's canonical delta gives the operations. A pinned plan
 *  replays the grant's exact resulting items, rebuilt from their known fields only. */
function buildDimension(board: PcbBoard, plan: DimensionPlan): BuiltExecution | BuildRefusal {
  const changes: DimensionChange[] = [];
  if ("mode" in plan) {
    if (!Array.isArray(plan.changes) || plan.changes.length === 0) return refusal("empty", "The plan names no dimension change.");
    if (plan.changes.length > MAX_GRANT_OPERATIONS) return refusal("too_many", `A grant covers at most ${MAX_GRANT_OPERATIONS} operations.`);
    changes.push(...plan.changes);
  } else {
    const edits = plan.edits;
    if (!Array.isArray(edits) || edits.length === 0) return refusal("empty", "The plan names no dimension edit.");
    if (edits.length > MAX_GRANT_OPERATIONS) return refusal("too_many", `A grant covers at most ${MAX_GRANT_OPERATIONS} operations.`);
    let addIndex = 0;
    for (const edit of edits) {
      if (edit.op === "add") {
        const body: Omit<BoardDimension, "id"> = { kind: edit.kind, a: { x: edit.a.x, y: edit.a.y }, b: { x: edit.b.x, y: edit.b.y }, offsetNm: edit.offsetNm, layer: edit.layer, unit: edit.unit, precision: edit.precision, textHeightNm: edit.textHeightNm, strokeWidthNm: edit.strokeWidthNm };
        changes.push({ op: "add", item: newBoardDimension({ id: aiDimensionId(board, addIndex, body), ...body }) });
        addIndex += 1;
        continue;
      }
      const current = dimensionOf(board, edit.dimensionId);
      if (!current) return refusal("unknown_target", `Dimension ${String(edit.dimensionId).slice(0, 60)} is not on this board.`);
      if (edit.op === "remove") { changes.push({ op: "remove", dimensionId: current.id }); continue; }
      const patch: DimensionPatch = {};
      for (const key of DIMENSION_PATCH_KEYS) if (edit[key] !== undefined) (patch as Record<string, unknown>)[key] = edit[key];
      const edited = produce(board, (draft) => mutateBoardWithDimensionCommand(draft, { kind: "EditDimension", id: current.id, patch }));
      changes.push({ op: "replace", item: dimensionOf(edited, current.id)! });
    }
  }
  // Validate every change against the base board (a pinned plan is re-checked here too); a no-op update is not a target.
  const touched = new Set<string>();
  const applied: DimensionChange[] = [];
  for (const change of changes) {
    const id = change.op === "remove" ? change.dimensionId : (change.item as { id?: unknown } | undefined)?.id;
    if (typeof id !== "string" || id.length === 0 || touched.has(id)) return refusal("unknown_target", "Each dimension may appear once per plan.");
    touched.add(id);
    const current = dimensionOf(board, id);
    if (change.op === "add" && current) return refusal("unknown_target", `The derived dimension id ${id.slice(0, 60)} already exists on this board.`);
    if (change.op !== "add" && !current) return refusal("unknown_target", `Dimension ${id.slice(0, 60)} is not on this board.`);
    if (change.op === "remove") { applied.push(change); continue; }
    const item = change.item;
    if (!isDimensionShaped(item)) return refusal("invalid_geometry", "A dimension change must carry a whole dimension.");
    if (change.op === "replace" && (item.a.x !== current!.a.x || item.a.y !== current!.a.y || item.b.x !== current!.b.x || item.b.y !== current!.b.y)) return refusal("invalid_geometry", "An update never moves a dimension's measured points (remove it and add a new one).");
    const problem = dimensionProblem(item, change.op === "replace" ? current : null);
    if (problem) return refusal("invalid_geometry", problem);
    if (change.op === "replace" && engineeringDigest(dimensionStyleOf(item)) === engineeringDigest(dimensionStyleOf(current!))) continue;
    applied.push(change);
  }
  const candidate = produce(board, (draft) => {
    for (const change of applied) {
      if (change.op === "add") mutateBoardWithDimensionCommand(draft, { kind: "AddDimension", item: newBoardDimension(change.item) });
      else if (change.op === "replace") mutateBoardWithDimensionCommand(draft, { kind: "EditDimension", id: change.item.id, patch: dimensionStyleOf(change.item) });
      else mutateBoardWithDimensionCommand(draft, { kind: "DeleteDimension", id: change.dimensionId });
    }
  });
  const describe = (operations: readonly EngineeringOperation[]) => {
    const before: string[] = [];
    const after: string[] = [];
    for (const operation of operations) {
      if (operation.kind === "add_dimension") { before.push("(new)"); after.push(describeDimension(operation.dimension)); }
      else if (operation.kind === "update_dimension") { before.push(describeDimension(dimensionOf(board, operation.dimensionId)!)); after.push(describeDimension(operation.replace)); }
      else if (operation.kind === "remove_dimension") { before.push(describeDimension(dimensionOf(board, operation.dimensionId)!)); after.push("(removed)"); }
    }
    return { before, after };
  };
  const targetIds = applied.map((change) => (change.op === "remove" ? change.dimensionId : change.item.id));
  return finishCandidate(board, plan.family, candidate, [], targetIds, [], [], "The plan changes nothing (every dimension already reads that way).", DIMENSION_OPERATION_KINDS, ["dimension"], [], describe);
}

/** Build the canonical operations for a plan against the exact board it must run on. */
export function buildExecutionOperations(board: PcbBoard, plan: ExecutionPlan): BuiltExecution | BuildRefusal {
  switch (plan.family) {
    case "pcb.move-footprint": return buildPositions(board, plan.family, plan.moves);
    case "pcb.rotate-side-footprint": return buildRotateSide(board, plan);
    case "pcb.arrange": return buildArrange(board, plan);
    case "pcb.silkscreen-text": return buildSilkText(board, plan);
    case "pcb.dimension": return buildDimension(board, plan);
    default: return refusal("unsupported_family", `Family ${String((plan as { family?: unknown }).family)} has no builder yet.`);
  }
}

/**
 * [B18-C I5] The ONE inverse: a grant's operations back to the plan that rebuilds them byte for byte (the browser's recompile).
 * A placement family takes only `move_footprint`: an arrange grant becomes its pinned `positions`, a rotate/flip grant carries
 * the absolute rotation and side of each operation. Silk text and dimension grants become their pinned resulting items
 * [B18-C I6/I7]. null ⇒ the operations are not a plan of that family (the ritual refuses).
 */
export function planFromOperations(family: ExecutionFamily, operations: readonly EngineeringOperation[]): ExecutionPlan | null {
  if (operations.length === 0) return null;
  if (family === "pcb.silkscreen-text") {
    const changes: SilkTextChange[] = [];
    for (const operation of operations) {
      if (operation.kind === "add_silk" && operation.item.kind === "text") changes.push({ op: "add", item: operation.item });
      else if (operation.kind === "update_silk" && operation.replace.kind === "text") changes.push({ op: "replace", item: operation.replace });
      else if (operation.kind === "remove_silk") changes.push({ op: "remove", silkId: operation.silkId });
      else return null;
    }
    return { family, mode: "pinned", changes };
  }
  if (family === "pcb.dimension") {
    const changes: DimensionChange[] = [];
    for (const operation of operations) {
      if (operation.kind === "add_dimension") changes.push({ op: "add", item: operation.dimension });
      else if (operation.kind === "update_dimension") changes.push({ op: "replace", item: operation.replace });
      else if (operation.kind === "remove_dimension") changes.push({ op: "remove", dimensionId: operation.dimensionId });
      else return null;
    }
    return { family, mode: "pinned", changes };
  }
  const moves: Array<Extract<EngineeringOperation, { kind: "move_footprint" }>> = [];
  for (const operation of operations) {
    if (operation.kind !== "move_footprint") return null;
    moves.push(operation);
  }
  if (family === "pcb.move-footprint") return { family, moves: moves.map((operation) => ({ footprintId: operation.footprintId, x: operation.at.x, y: operation.at.y })) };
  if (family === "pcb.arrange") return { family, mode: "positions", moves: moves.map((operation) => ({ footprintId: operation.footprintId, x: operation.at.x, y: operation.at.y })) };
  if (family === "pcb.rotate-side-footprint") {
    const targets: RotateSidePlan["targets"] = [];
    for (const operation of moves) {
      if (typeof operation.rotationDeg !== "number" || (operation.side !== "top" && operation.side !== "bottom")) return null;
      targets.push({ footprintId: operation.footprintId, rotationDeg: operation.rotationDeg, side: operation.side });
    }
    return { family, targets };
  }
  return null;
}
