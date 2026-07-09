/**
 * Zone history commands (PCB Stage 11) — PURE, no Pixi/React/DOM.
 *
 * DEVIATION FROM THE PINNED SHAPE (same as Stages 8/9, documented in the
 * progress note): the plan pinned extending a command union in Stage 5's
 * `commands.ts`, but no such file exists — Stage 5 history is immer-patch
 * based with no central command layer. Following the Stage 8/9 precedent the
 * union is self-contained here; the live editor commits via
 * `history.execute(zoneCommandLabel(cmd), d => mutateBoardWithZoneCommand(d, cmd))`
 * and undo/redo ride the patch log. `applyZoneCommand`/`invertZoneCommand`
 * are the pure reference pair the tests exercise.
 *
 * "AddPlane" is `AddZone` with a `makePlaneZone(...)` payload — no separate
 * command kind. Fill computation is NOT part of any command: fills are
 * derived state that `useZoneFills` recomputes after commits (and after the
 * undo/redo of anything that dirtied a layer).
 */

import { produce } from "immer";
import type { PcbBoard, Zone, FilledRegion } from "../types";

export type ZoneCommand =
  | { kind: "AddZone"; zone: Zone }
  | { kind: "EditZone"; id: string; before: Zone; after: Zone }
  | { kind: "DeleteZone"; before: Zone };

function cloneRegion(r: FilledRegion): FilledRegion {
  return {
    outer: r.outer.map((p) => ({ ...p })),
    holes: r.holes.map((h) => h.map((p) => ({ ...p }))),
    boundingBox: { ...r.boundingBox },
    areaNm2: r.areaNm2,
  };
}

export function cloneZone(z: Zone): Zone {
  return {
    ...z,
    polygon: z.polygon.map((p) => ({ ...p })),
    ...(z.thermal ? { thermal: { ...z.thermal } } : {}),
    fill: z.fill.map(cloneRegion),
  };
}

/**
 * Apply by mutating an immer draft (or any writable board). Deep-copies the
 * command's zone so the board never aliases it.
 */
export function mutateBoardWithZoneCommand(board: PcbBoard, cmd: ZoneCommand): void {
  switch (cmd.kind) {
    case "AddZone":
      board.zones.push({ ...cloneZone(cmd.zone), dirty: true });
      return;
    case "EditZone": {
      const i = board.zones.findIndex((z) => z.id === cmd.id);
      if (i >= 0) board.zones[i] = { ...cloneZone(cmd.after), dirty: true };
      return;
    }
    case "DeleteZone":
      board.zones = board.zones.filter((z) => z.id !== cmd.before.id);
      return;
  }
}

/** Pure form — returns a new board. Tests and redo reference. */
export function applyZoneCommand(board: PcbBoard, cmd: ZoneCommand): PcbBoard {
  return produce(board, (draft) => mutateBoardWithZoneCommand(draft, cmd));
}

/** AddZone ⇄ DeleteZone; EditZone is self-inverse with before/after swapped. */
export function invertZoneCommand(cmd: ZoneCommand): ZoneCommand {
  switch (cmd.kind) {
    case "AddZone":
      return { kind: "DeleteZone", before: cloneZone(cmd.zone) };
    case "EditZone":
      return { kind: "EditZone", id: cmd.id, before: cloneZone(cmd.after), after: cloneZone(cmd.before) };
    case "DeleteZone":
      return { kind: "AddZone", zone: cloneZone(cmd.before) };
  }
}

/** Human-readable history label. */
export function zoneCommandLabel(cmd: ZoneCommand, board?: PcbBoard): string {
  const netName = (netId: number): string =>
    board?.nets.find((n) => n.id === netId)?.name || `net ${netId}`;
  switch (cmd.kind) {
    case "AddZone":
      return `Add ${netName(cmd.zone.netId)} zone`;
    case "EditZone":
      return `Edit ${netName(cmd.after.netId)} zone`;
    case "DeleteZone":
      return `Delete ${netName(cmd.before.netId)} zone`;
  }
}
