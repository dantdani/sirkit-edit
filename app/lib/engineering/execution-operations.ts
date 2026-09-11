/**
 * [B18-B] ONE pure operation builder per execution family — the SAME
 * compilers the interactive editor session uses (`compileEdits` → the exact
 * mutator semantics and validation; `compilePcbBoardDelta` → the canonical
 * operations with deterministic ids), so an agent plan, the explicit-request
 * grammar's derivation and the browser's recompile at commit time all produce
 * byte-identical operations for the same intent against the same board.
 *
 * No parallel mutation code exists here: a plan is a list of edit commands.
 */
import { compileEdits } from "../pcb/edit/apply";
import { pcbRevisionId } from "../pcb/revision";
import type { EditCommand, SelectionRef } from "../pcb/edit/commands";
import type { PcbBoard } from "../pcb/types";
import { nmToMm } from "../pcb/units";
import { compilePcbBoardDelta } from "./pcb-delta";
import { executionOperationsDigest, executionPreviewDigest, executionTargetsDigest, MAX_GRANT_OPERATIONS, type ExecutionFamily, type ExecutionGrantPreview, type ExecutionGrantTargets } from "./execution-grant";
import { applyEngineeringOperations } from "./operations";
import { canonicalLineageDigest } from "./semantic-board-digest";
import { STAGE10_SCHEMA_VERSION, type EngineeringOperation } from "./types";

/** A move plan: absolute integer-nm targets per footprint (the tool's argument shape). */
export interface MoveFootprintPlan { family: "pcb.move-footprint"; moves: Array<{ footprintId: string; x: number; y: number }> }
export type ExecutionPlan = MoveFootprintPlan;

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

/** Build the canonical operations for a plan against the exact board it must run on. */
export function buildExecutionOperations(board: PcbBoard, plan: ExecutionPlan): BuiltExecution | BuildRefusal {
  if (plan.family !== "pcb.move-footprint") return { ok: false, code: "unsupported_family", message: `Family ${String((plan as { family?: unknown }).family)} has no builder in B18-B.` };
  const moves = plan.moves;
  if (!Array.isArray(moves) || moves.length === 0) return { ok: false, code: "empty", message: "The plan names no footprint to move." };
  if (moves.length > MAX_GRANT_OPERATIONS) return { ok: false, code: "too_many", message: `A grant covers at most ${MAX_GRANT_OPERATIONS} operations.` };
  const commands: EditCommand[] = [];
  const before: string[] = [];
  const after: string[] = [];
  const seen = new Set<string>();
  for (const move of moves) {
    if (typeof move.footprintId !== "string" || move.footprintId.length === 0 || seen.has(move.footprintId)) return { ok: false, code: "unknown_target", message: "Each move must name one distinct footprint id." };
    seen.add(move.footprintId);
    const footprint = board.footprints.find((item) => item.id === move.footprintId);
    if (!footprint) return { ok: false, code: "unknown_target", message: `Footprint ${move.footprintId} is not on this board.` };
    if (footprint.locked) return { ok: false, code: "locked_target", message: `Footprint ${footprint.ref} is locked; a locked footprint is never moved by an agent.` };
    if (!Number.isSafeInteger(move.x) || !Number.isSafeInteger(move.y)) return { ok: false, code: "invalid_geometry", message: "Targets must be integer nanometres." };
    const ref: SelectionRef = { kind: "footprint", id: footprint.id };
    commands.push({ op: "set-position", ref, atNm: { x: move.x, y: move.y } });
    before.push(`${footprint.ref} at (${fmt(footprint.at.x)}, ${fmt(footprint.at.y)}) mm`);
    after.push(`${footprint.ref} at (${fmt(move.x)}, ${fmt(move.y)}) mm`);
  }
  const compiled = compileEdits(board, commands);
  if (compiled.errors.length > 0) return { ok: false, code: "compile_failed", message: compiled.errors[0]! };
  const delta = compilePcbBoardDelta(board, compiled.result, plan.family);
  const operations = delta.operations.filter((operation) => operation.kind === "move_footprint");
  if (operations.length === 0) return { ok: false, code: "no_change", message: "The plan changes nothing (every footprint is already at its target)." };
  if (operations.length !== delta.operations.length) return { ok: false, code: "compile_failed", message: "The plan compiled to operations outside the move-footprint family." };
  // [B18-C review V0] the expected result is what the canonical KERNEL commits from these exact operations — not the
  // editor mutator's board. A kernel refusal here refuses the plan before any grant exists.
  let predicted: PcbBoard;
  try {
    predicted = applyEngineeringOperations({ schemaVersion: STAGE10_SCHEMA_VERSION, tenantId: "", projectId: "", branchId: "", pcb: board, pinnedAssets: [] }, operations).project.pcb;
  } catch (error) {
    return { ok: false, code: "compile_failed", message: `The canonical kernel refuses the plan: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}` };
  }
  const targets: ExecutionGrantTargets = { resolvedFrom: "named", objectIds: [...seen].sort(), netIds: [], kinds: ["footprint"], selectionDigest: null, targetsDigest: "" };
  targets.targetsDigest = executionTargetsDigest(targets);
  const preview: ExecutionGrantPreview = { before: before.join("; "), after: after.join("; "), warnings: compiled.diagnostics.map((diagnostic) => diagnostic.summary).slice(0, 8) };
  const operationsDigest = executionOperationsDigest(plan.family, operations);
  return { ok: true, family: plan.family, operations, operationsDigest, targets, preview, previewDigest: executionPreviewDigest({ operationsDigest, targetsDigest: targets.targetsDigest, preview }), commands, resultRevision: pcbRevisionId(predicted), resultLineageDigest: canonicalLineageDigest(predicted) };
}
