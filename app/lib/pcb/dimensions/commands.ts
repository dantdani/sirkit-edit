/**
 * [B18-C I7] Dimension-annotation board edits — PURE (no Pixi/React/DOM).
 *
 * The editor's dimension tool (add), its inspector (edit) and the agent's
 * granted dimension execution all build their candidate boards through THESE
 * functions, so a dimension placed by the AI is exactly what the editor itself
 * would place. The editor's Delete key removes a dimension through the
 * `delete-items` mutator; `DeleteDimension` has the same semantics (drop the
 * item by id).
 */

import type { Vec2 } from "../geometry";
import type { BoardDimension, DimensionKind, DimensionLayer, PcbBoard } from "../types";
import { DEFAULT_SILK_STROKE_NM, DEFAULT_SILK_TEXT_HEIGHT_NM } from "../silk/types";

export const DIMENSION_KINDS = Object.freeze(["horizontal", "vertical", "aligned"] as const satisfies readonly DimensionKind[]);

/** What the dimension tool places when nothing else is chosen (the inspector edits these afterwards). */
export const DIMENSION_DEFAULTS = Object.freeze({
  layer: "silkTop" as DimensionLayer,
  unit: "mm" as BoardDimension["unit"],
  precision: 2 as BoardDimension["precision"],
  textHeightNm: DEFAULT_SILK_TEXT_HEIGHT_NM,
  strokeWidthNm: DEFAULT_SILK_STROKE_NM,
});

/** The fields the inspector edits in place (the measured endpoints never are). */
export type DimensionPatch = Partial<Pick<BoardDimension, "kind" | "offsetNm" | "layer" | "unit" | "precision" | "textHeightNm" | "strokeWidthNm">>;

type DimensionStyle = Pick<BoardDimension, "layer" | "unit" | "precision" | "textHeightNm" | "strokeWidthNm">;

/** A new dimension over integer-nm endpoints; any style field not given takes the tool's default. */
export function newBoardDimension(input: { id: string; kind: DimensionKind; a: Vec2; b: Vec2; offsetNm: number } & Partial<DimensionStyle>): BoardDimension {
  return {
    id: input.id,
    kind: input.kind,
    a: { x: input.a.x, y: input.a.y },
    b: { x: input.b.x, y: input.b.y },
    offsetNm: input.offsetNm,
    layer: input.layer ?? DIMENSION_DEFAULTS.layer,
    unit: input.unit ?? DIMENSION_DEFAULTS.unit,
    precision: input.precision ?? DIMENSION_DEFAULTS.precision,
    textHeightNm: input.textHeightNm ?? DIMENSION_DEFAULTS.textHeightNm,
    strokeWidthNm: input.strokeWidthNm ?? DIMENSION_DEFAULTS.strokeWidthNm,
  };
}

export type DimensionCommand =
  | { kind: "AddDimension"; item: BoardDimension }
  | { kind: "EditDimension"; id: string; patch: DimensionPatch }
  | { kind: "DeleteDimension"; id: string };

/** Apply by mutating an immer draft (or any writable board). `dimensions` is optional on older boards — created on the first
 *  add. The added item is copied so the board never aliases the command. */
export function mutateBoardWithDimensionCommand(board: PcbBoard, cmd: DimensionCommand): void {
  switch (cmd.kind) {
    case "AddDimension":
      (board.dimensions ??= []).push({ ...cmd.item, a: { ...cmd.item.a }, b: { ...cmd.item.b } });
      return;
    case "EditDimension": {
      const target = (board.dimensions ?? []).find((dimension) => dimension.id === cmd.id);
      if (target) Object.assign(target, cmd.patch);
      return;
    }
    case "DeleteDimension":
      if (board.dimensions) board.dimensions = board.dimensions.filter((dimension) => dimension.id !== cmd.id);
      return;
  }
}
