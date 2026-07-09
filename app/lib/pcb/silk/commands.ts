/**
 * Silk history commands (PCB Stage 16) — PURE, no Pixi/React/DOM. Same
 * self-contained-union pattern as Stages 8/9/11 (zones/command.ts): the live
 * editor commits via
 * `history.execute(silkCommandLabel(cmd), d => mutateBoardWithSilkCommand(d, cmd))`
 * and undo/redo ride the immer patch log; `applySilkCommand` /
 * `invertSilkCommand` are the pure reference pair the tests exercise.
 */

import { produce } from "immer";
import type { PcbBoard } from "../types";
import type { SilkItem } from "./types";

export type SilkCommand =
  | { kind: "AddSilk"; item: SilkItem }
  | { kind: "EditSilk"; id: string; before: SilkItem; after: SilkItem }
  | { kind: "DeleteSilk"; before: SilkItem };

export function cloneSilkItem(item: SilkItem): SilkItem {
  switch (item.kind) {
    case "text":
      return { ...item, position: { ...item.position } };
    case "line":
      return { ...item, from: { ...item.from }, to: { ...item.to } };
    case "rect":
      return { ...item, corner1: { ...item.corner1 }, corner2: { ...item.corner2 } };
    case "circle":
      return { ...item, center: { ...item.center } };
  }
}

/** Apply by mutating an immer draft (or any writable board). Deep-copies the
 * command's item so the board never aliases it. `silkItems` is optional on
 * older boards — created on first write. */
export function mutateBoardWithSilkCommand(board: PcbBoard, cmd: SilkCommand): void {
  const items = board.silkItems ?? (board.silkItems = []);
  switch (cmd.kind) {
    case "AddSilk":
      items.push(cloneSilkItem(cmd.item));
      return;
    case "EditSilk": {
      const i = items.findIndex((s) => s.id === cmd.id);
      if (i >= 0) items[i] = cloneSilkItem(cmd.after);
      return;
    }
    case "DeleteSilk":
      board.silkItems = items.filter((s) => s.id !== cmd.before.id);
      return;
  }
}

/** Pure form — returns a new board. Tests and redo reference. */
export function applySilkCommand(board: PcbBoard, cmd: SilkCommand): PcbBoard {
  return produce(board, (draft) => mutateBoardWithSilkCommand(draft, cmd));
}

/** AddSilk ⇄ DeleteSilk; EditSilk is self-inverse with before/after swapped. */
export function invertSilkCommand(cmd: SilkCommand): SilkCommand {
  switch (cmd.kind) {
    case "AddSilk":
      return { kind: "DeleteSilk", before: cloneSilkItem(cmd.item) };
    case "EditSilk":
      return { kind: "EditSilk", id: cmd.id, before: cloneSilkItem(cmd.after), after: cloneSilkItem(cmd.before) };
    case "DeleteSilk":
      return { kind: "AddSilk", item: cloneSilkItem(cmd.before) };
  }
}

const KIND_NAME: Record<SilkItem["kind"], string> = {
  text: "text",
  line: "line",
  rect: "rectangle",
  circle: "circle",
};

function describe(item: SilkItem): string {
  return item.kind === "text" ? `silk text "${item.text}"` : `silk ${KIND_NAME[item.kind]}`;
}

/** Human-readable history label. */
export function silkCommandLabel(cmd: SilkCommand): string {
  switch (cmd.kind) {
    case "AddSilk":
      return `Add ${describe(cmd.item)}`;
    case "EditSilk":
      return `Edit ${describe(cmd.after)}`;
    case "DeleteSilk":
      return `Delete ${describe(cmd.before)}`;
  }
}
