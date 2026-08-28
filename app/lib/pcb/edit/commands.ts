/**
 * Edit-command layer (PCB Stage 17) — the PINNED shared substrate every
 * property edit goes through: inspector fields, batch operations, the command
 * palette, and the AI assist endpoint all emit `EditCommand`s. One validator
 * (validate.ts), one `history.execute()` path (apply.ts), one preview-DRC path
 * (preview.ts, Phase B).
 *
 * Every command is JSON-serializable by construction — ids and refs only,
 * never object references — so commands can cross the AI endpoint boundary
 * verbatim. Commands compile to `(draft: PcbBoard) => void` mutators
 * internally (apply.ts); immer patches are the undo — NO inverse code exists
 * anywhere in this layer.
 *
 * Reviewer rule: every future editing feature must be expressible as an
 * `EditCommand` first, UI second. PRs that mutate the board outside this
 * layer (existing gesture tools excepted) should be rejected.
 */

import type { Vec2 } from "../geometry";
import type { LayerId } from "../layers";
import type { DrcViolation } from "../drc/types";
import type { PadstackInput } from "../padstack/types";

/** A reference to one selectable board item. Pads are addressed through their
 *  footprint (pad geometry has no standalone id — see Stage 1 invariant). */
export type SelectionRef =
  | { kind: "via" | "track" | "zone" | "text" | "footprint" | "dimension"; id: string }
  | { kind: "pad"; footprintId: string; padNumber: string };

export type EditCommand =
  | { op: "set-track-width"; ids: string[]; widthNm: number }
  | { op: "set-item-layer"; refs: SelectionRef[]; layer: LayerId } // tracks/zones/text only; validator rejects others
  | { op: "move-items"; refs: SelectionRef[]; deltaNm: Vec2 }
  | { op: "set-position"; ref: SelectionRef; atNm: Vec2 }
  | { op: "rotate-items"; refs: SelectionRef[]; quarterTurns: 1 | -1; pivotNm?: Vec2 }
  | {
      op: "set-footprint-props";
      id: string;
      patch: { rotationDeg?: number; side?: "top" | "bottom"; locked?: boolean };
    }
  | {
      op: "set-zone-props";
      id: string;
      patch: { netId?: number; connect?: "thermal" | "solid"; clearanceNm?: number };
    }
  | {
      op: "set-text-props";
      id: string;
      patch: { text?: string; sizeNm?: number; thicknessNm?: number; layer?: LayerId };
    }
  | { op: "delete-items"; refs: SelectionRef[] } // footprints rejected by validator
  | {
      op: "align";
      refs: SelectionRef[];
      mode: "left" | "right" | "top" | "bottom" | "centerH" | "centerV";
    } // Phase D impl
  | { op: "distribute"; refs: SelectionRef[]; axis: "h" | "v" }
  | { op: "snap-to-grid"; refs: SelectionRef[]; gridNm: number }
  | { op: "create-padstack"; padstack: PadstackInput } // Phase C impl
  | { op: "edit-padstack"; id: string; patch: Partial<PadstackInput> }
  | { op: "set-via-padstack"; viaIds: string[]; padstackId: string }
  | { op: "set-copper-locked"; refs: Array<{ kind: "track" | "via" | "zone"; id: string }>; locked: boolean }
  | { op: "delete-padstack"; id: string };

export interface EditResult {
  ok: boolean;
  errors: string[];
  violations: DrcViolation[];
  label: string;
  diagnostics?: import("../integrity").EngineeringDiagnostic[];
}

/** Stable identity key for a ref — selection-set membership and dedupe. */
export function refKey(ref: SelectionRef): string {
  return ref.kind === "pad" ? `pad:${ref.footprintId}:${ref.padNumber}` : `${ref.kind}:${ref.id}`;
}

export function sameRef(a: SelectionRef, b: SelectionRef): boolean {
  return refKey(a) === refKey(b);
}
