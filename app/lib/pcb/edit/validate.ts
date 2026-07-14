/**
 * Edit-command validation (PCB Stage 17) — the ONE gate every command passes
 * before it may touch the board. UI fields, batch actions, the palette and
 * the AI assist path all call this (the AI path validates twice: server-side
 * against the digest schema, client-side here against the live board).
 *
 * Returns plain-English error strings ([] = valid) in the Stage 12 message
 * voice: no codes, name the item, say what to do instead. Validation is pure
 * and read-only.
 */

import type { PcbBoard, Track, Via, Zone, FootprintInstance } from "../types";
import type { SilkTextItem } from "../silk/types";
import type { LayerId } from "../layers";
import type { Vec2 } from "../geometry";
import type { EditCommand, SelectionRef } from "./commands";

// ── Item lookup (shared with apply.ts / describe.ts) ─────────────────────────

export function findTrack(board: PcbBoard, id: string): Track | undefined {
  return board.tracks.find((t) => t.id === id);
}

export function findVia(board: PcbBoard, id: string): Via | undefined {
  return board.vias.find((v) => v.id === id);
}

export function findZone(board: PcbBoard, id: string): Zone | undefined {
  return board.zones.find((z) => z.id === id);
}

/** Stage 17 'text' refs address silk TEXT items (board.silkItems, Stage 16).
 *  The legacy `board.texts` field is not selectable/editable. */
export function findSilkText(board: PcbBoard, id: string): SilkTextItem | undefined {
  const item = (board.silkItems ?? []).find((s) => s.id === id);
  return item?.kind === "text" ? item : undefined;
}

export function findFootprint(board: PcbBoard, id: string): FootprintInstance | undefined {
  return board.footprints.find((f) => f.id === id);
}

/** True when the ref resolves to a live board item. */
export function refExists(board: PcbBoard, ref: SelectionRef): boolean {
  switch (ref.kind) {
    case "via":
      return findVia(board, ref.id) !== undefined;
    case "track":
      return findTrack(board, ref.id) !== undefined;
    case "zone":
      return findZone(board, ref.id) !== undefined;
    case "text":
      return findSilkText(board, ref.id) !== undefined;
    case "footprint":
      return findFootprint(board, ref.id) !== undefined;
    case "pad": {
      const fp = findFootprint(board, ref.footprintId);
      return fp !== undefined && fp.def.pads.some((p) => p.number === ref.padNumber);
    }
  }
}

export function describeRef(ref: SelectionRef): string {
  return ref.kind === "pad"
    ? `pad ${ref.padNumber} of ${ref.footprintId}`
    : `${ref.kind} ${ref.id}`;
}

// ── Field validators ─────────────────────────────────────────────────────────

const COPPER_2L: readonly LayerId[] = ["copperTop", "copperBottom"];
const COPPER_4L: readonly LayerId[] = ["copperTop", "in1", "in2", "copperBottom"];
const SILK: readonly LayerId[] = ["silkTop", "silkBottom"];

function copperLayers(board: PcbBoard): readonly LayerId[] {
  return board.stackup === 4 ? COPPER_4L : COPPER_2L;
}

function isPositiveDim(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isFiniteVec(v: unknown): v is Vec2 {
  return (
    typeof v === "object" &&
    v !== null &&
    isFiniteNumber((v as Vec2).x) &&
    isFiniteNumber((v as Vec2).y)
  );
}

function checkRefs(
  board: PcbBoard,
  refs: SelectionRef[],
  errors: string[],
  what: string,
): void {
  if (!Array.isArray(refs) || refs.length === 0) {
    errors.push(`Nothing to ${what} — the command has no targets.`);
    return;
  }
  for (const ref of refs) {
    if (!refExists(board, ref)) errors.push(`No ${describeRef(ref)} on this board.`);
  }
}

/** Locked footprints refuse move/rotate — collect errors for any in `refs`. */
function checkNotLocked(board: PcbBoard, refs: SelectionRef[], errors: string[], verb: string): void {
  for (const ref of refs) {
    if (ref.kind !== "footprint") continue;
    const fp = findFootprint(board, ref.id);
    if (fp?.locked) errors.push(`${fp.ref} is locked — unlock it before you ${verb} it.`);
  }
}

// ── The validator ────────────────────────────────────────────────────────────

/** [] = valid. Unknown ids, illegal targets, NaN/negative dims all rejected. */
export function validateCommand(board: PcbBoard, cmd: EditCommand): string[] {
  const errors: string[] = [];

  switch (cmd.op) {
    case "set-track-width": {
      if (!Array.isArray(cmd.ids) || cmd.ids.length === 0) {
        errors.push("Nothing to resize — the command has no track ids.");
        break;
      }
      for (const id of cmd.ids) {
        if (!findTrack(board, id)) errors.push(`No track ${id} on this board.`);
      }
      if (!isPositiveDim(cmd.widthNm)) {
        errors.push("Track width must be a positive number of nanometers.");
      }
      break;
    }

    case "set-item-layer": {
      checkRefs(board, cmd.refs, errors, "re-layer");
      for (const ref of cmd.refs) {
        if (ref.kind === "track" || ref.kind === "zone") {
          if (!copperLayers(board).includes(cmd.layer)) {
            errors.push(
              `${describeRef(ref)} can only sit on a copper layer of this ${board.stackup}-layer board.`,
            );
          }
        } else if (ref.kind === "text") {
          if (!SILK.includes(cmd.layer)) {
            errors.push(`Text can only sit on a silkscreen layer.`);
          }
        } else {
          errors.push(
            `The layer of a ${ref.kind} can't be changed — only tracks, zones and text.`,
          );
        }
      }
      break;
    }

    case "move-items": {
      checkRefs(board, cmd.refs, errors, "move");
      for (const ref of cmd.refs) {
        if (ref.kind === "pad") {
          errors.push("Pads move with their footprint — move the footprint instead.");
        }
      }
      checkNotLocked(board, cmd.refs, errors, "move");
      if (!isFiniteVec(cmd.deltaNm)) errors.push("Move delta must be finite x/y nanometers.");
      break;
    }

    case "set-position": {
      const ref = cmd.ref;
      if (!ref || !refExists(board, ref)) {
        errors.push(`No ${ref ? describeRef(ref) : "item"} on this board.`);
        break;
      }
      if (ref.kind !== "via" && ref.kind !== "footprint" && ref.kind !== "text") {
        errors.push(
          `The position of a ${ref.kind} can't be set directly — only vias, footprints and text.`,
        );
      }
      checkNotLocked(board, [ref], errors, "move");
      if (!isFiniteVec(cmd.atNm)) errors.push("Position must be finite x/y nanometers.");
      break;
    }

    case "rotate-items": {
      checkRefs(board, cmd.refs, errors, "rotate");
      for (const ref of cmd.refs) {
        if (ref.kind === "pad") {
          errors.push("Pads rotate with their footprint — rotate the footprint instead.");
        }
      }
      checkNotLocked(board, cmd.refs, errors, "rotate");
      if (cmd.quarterTurns !== 1 && cmd.quarterTurns !== -1) {
        errors.push("Rotation must be a single quarter turn (1 or -1).");
      }
      if (cmd.pivotNm !== undefined && !isFiniteVec(cmd.pivotNm)) {
        errors.push("Rotation pivot must be finite x/y nanometers.");
      }
      break;
    }

    case "set-footprint-props": {
      const fp = findFootprint(board, cmd.id);
      if (!fp) {
        errors.push(`No footprint ${cmd.id} on this board.`);
        break;
      }
      const patch = cmd.patch ?? {};
      const keys = Object.keys(patch);
      if (keys.length === 0) errors.push("Nothing to change on the footprint.");
      if (patch.rotationDeg !== undefined && !isFiniteNumber(patch.rotationDeg)) {
        errors.push("Rotation must be a finite number of degrees.");
      }
      if (patch.side !== undefined && patch.side !== "top" && patch.side !== "bottom") {
        errors.push("Side must be 'top' or 'bottom'.");
      }
      if (patch.locked !== undefined && typeof patch.locked !== "boolean") {
        errors.push("Locked must be true or false.");
      }
      if (
        fp.locked &&
        patch.locked !== false &&
        (patch.rotationDeg !== undefined || patch.side !== undefined)
      ) {
        errors.push(`${fp.ref} is locked — unlock it before you move or rotate it.`);
      }
      break;
    }

    case "set-zone-props": {
      const zone = findZone(board, cmd.id);
      if (!zone) {
        errors.push(`No zone ${cmd.id} on this board.`);
        break;
      }
      const patch = cmd.patch ?? {};
      if (Object.keys(patch).length === 0) errors.push("Nothing to change on the zone.");
      if (patch.netId !== undefined) {
        if (!Number.isInteger(patch.netId) || !board.nets.some((n) => n.id === patch.netId)) {
          errors.push(`No net ${patch.netId} on this board.`);
        }
      }
      if (patch.connect !== undefined && patch.connect !== "thermal" && patch.connect !== "solid") {
        errors.push("Zone connection must be 'thermal' or 'solid'.");
      }
      if (
        patch.clearanceNm !== undefined &&
        !(isFiniteNumber(patch.clearanceNm) && patch.clearanceNm >= 0)
      ) {
        errors.push("Zone clearance must be zero or a positive number of nanometers.");
      }
      break;
    }

    case "set-text-props": {
      const item = findSilkText(board, cmd.id);
      if (!item) {
        errors.push(`No text ${cmd.id} on this board.`);
        break;
      }
      const patch = cmd.patch ?? {};
      if (Object.keys(patch).length === 0) errors.push("Nothing to change on the text.");
      if (patch.text !== undefined && (typeof patch.text !== "string" || patch.text.length === 0)) {
        errors.push("Text can't be empty.");
      }
      if (patch.sizeNm !== undefined && !isPositiveDim(patch.sizeNm)) {
        errors.push("Text size must be a positive number of nanometers.");
      }
      if (patch.thicknessNm !== undefined && !isPositiveDim(patch.thicknessNm)) {
        errors.push("Text stroke must be a positive number of nanometers.");
      }
      if (patch.layer !== undefined && !SILK.includes(patch.layer)) {
        errors.push("Text can only sit on a silkscreen layer.");
      }
      break;
    }

    case "delete-items": {
      checkRefs(board, cmd.refs, errors, "delete");
      for (const ref of cmd.refs) {
        if (ref.kind === "footprint") {
          errors.push(
            "Footprints can't be deleted on the board — remove the part from the schematic and re-sync.",
          );
        } else if (ref.kind === "pad") {
          errors.push("Pads belong to their footprint and can't be deleted on the board.");
        }
      }
      break;
    }

    // Phase D — arrange commands land with edit/arrange.ts.
    case "align":
    case "distribute":
    case "snap-to-grid":
      errors.push(`'${cmd.op}' isn't available yet (Stage 17 Phase D).`);
      break;

    // Phase C — padstack commands land with padstack/registry.ts.
    case "create-padstack":
    case "edit-padstack":
    case "set-via-padstack":
    case "delete-padstack":
      errors.push(`'${cmd.op}' isn't available yet (Stage 17 Phase C).`);
      break;

    default: {
      // AI/JSON boundary: `cmd` may not be a real EditCommand at runtime.
      const op = (cmd as { op?: unknown }).op;
      errors.push(`Unknown edit command '${String(op)}'.`);
    }
  }

  return errors;
}
