/**
 * Human-readable edit descriptions (PCB Stage 17) — one voice for history
 * labels, context-menu feedback and the AI assist echo. Values in mm via
 * formatMm, layers by display name, never KiCad names, no codes.
 */

import { formatMm } from "../units";
import { LAYER_DEFS } from "../render/colors";
import type { LayerId } from "../layers";
import type { PcbBoard } from "../types";
import type { EditCommand, SelectionRef } from "./commands";
import { findFootprint } from "./validate";
import { getPadstack } from "../padstack/registry";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function layerName(layer: LayerId): string {
  return LAYER_DEFS.get(layer)?.displayName ?? layer;
}

function netName(board: PcbBoard, netId: number): string {
  const net = board.nets.find((n) => n.id === netId);
  return net && net.name !== "" ? net.name : `net ${netId}`;
}

/** 'R3', '2 vias', '5 items' — group refs into the shortest honest phrase. */
function describeRefs(board: PcbBoard, refs: SelectionRef[]): string {
  if (refs.length === 1) {
    const ref = refs[0];
    switch (ref.kind) {
      case "footprint":
        return findFootprint(board, ref.id)?.ref ?? "footprint";
      case "pad":
        return `pad ${ref.padNumber} of ${findFootprint(board, ref.footprintId)?.ref ?? ref.footprintId}`;
      case "text":
        return "silk text";
      default:
        return ref.kind;
    }
  }
  const kinds = new Set(refs.map((r) => r.kind));
  if (kinds.size === 1) {
    const kind = refs[0].kind;
    const word = kind === "text" ? "text item" : kind === "footprint" ? "part" : kind;
    return plural(refs.length, word);
  }
  return plural(refs.length, "item");
}

function describeOne(board: PcbBoard, cmd: EditCommand): string {
  switch (cmd.op) {
    case "set-track-width":
      return `Set width ${formatMm(cmd.widthNm)} mm on ${plural(cmd.ids.length, "track")}`;
    case "set-item-layer":
      return `Move ${describeRefs(board, cmd.refs)} to ${layerName(cmd.layer)}`;
    case "move-items":
      return `Move ${describeRefs(board, cmd.refs)}`;
    case "set-position":
      return `Move ${describeRefs(board, [cmd.ref])}`;
    case "rotate-items":
      return `Rotate ${describeRefs(board, cmd.refs)}`;
    case "set-footprint-props": {
      const ref = findFootprint(board, cmd.id)?.ref ?? cmd.id;
      const keys = Object.keys(cmd.patch);
      if (keys.length === 1 && cmd.patch.locked !== undefined) {
        return `${cmd.patch.locked ? "Lock" : "Unlock"} ${ref}`;
      }
      if (keys.length === 1 && cmd.patch.side !== undefined) return `Flip ${ref} to ${cmd.patch.side}`;
      if (keys.length === 1 && cmd.patch.rotationDeg !== undefined) {
        return `Rotate ${ref} to ${cmd.patch.rotationDeg}°`;
      }
      return `Edit ${ref}`;
    }
    case "set-zone-props": {
      const p = cmd.patch;
      if (p.netId !== undefined && Object.keys(p).length === 1) {
        return `Set zone net to ${netName(board, p.netId)}`;
      }
      if (p.connect !== undefined && Object.keys(p).length === 1) {
        return `Set zone connection to ${p.connect}`;
      }
      if (p.clearanceNm !== undefined && Object.keys(p).length === 1) {
        return `Set zone clearance to ${formatMm(p.clearanceNm)} mm`;
      }
      return "Edit zone";
    }
    case "set-text-props":
      return cmd.patch.text !== undefined ? `Edit silk text "${cmd.patch.text}"` : "Edit silk text";
    case "delete-items":
      return `Delete ${describeRefs(board, cmd.refs)}`;
    case "align":
      return `Align ${describeRefs(board, cmd.refs)} (${cmd.mode})`;
    case "distribute":
      return `Distribute ${describeRefs(board, cmd.refs)} ${cmd.axis === "h" ? "horizontally" : "vertically"}`;
    case "snap-to-grid":
      return `Snap ${describeRefs(board, cmd.refs)} to ${formatMm(cmd.gridNm)} mm grid`;
    case "create-padstack":
      return `Add padstack '${cmd.padstack.name}'`;
    case "edit-padstack": {
      const name = getPadstack(board, cmd.id)?.name;
      return name ? `Edit padstack '${name}'` : "Edit padstack";
    }
    case "set-via-padstack": {
      const name = getPadstack(board, cmd.padstackId)?.name;
      return `Set ${plural(cmd.viaIds.length, "via")} to ${name ? `'${name}'` : "padstack"}`;
    }
    case "delete-padstack": {
      const name = getPadstack(board, cmd.id)?.name;
      return name ? `Delete padstack '${name}'` : "Delete padstack";
    }
  }
}

/** One line for a whole batch — the history label and the AI echo. */
export function describeEdits(board: PcbBoard, cmds: EditCommand[]): string {
  if (cmds.length === 0) return "No changes";
  const first = describeOne(board, cmds[0]);
  if (cmds.length === 1) return first;
  return `${first} (+${plural(cmds.length - 1, "more edit")})`;
}
