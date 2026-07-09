// LayerId → KiCad layer names + the `(layers ...)` header table (Stage 13).
// The map is spelled out literally (pinned) — Record<LayerId, string> makes
// the compiler reject a partial map, and kicad-layer-map.test.ts additionally
// asserts agreement with Stage 1's LAYERS table.

import type { LayerId } from "../layers";
import { LAYERS } from "../layers";

export const LAYER_MAP: Record<LayerId, string> = {
  copperTop: "F.Cu",
  in1: "In1.Cu",
  in2: "In2.Cu",
  copperBottom: "B.Cu",
  silkTop: "F.SilkS",
  silkBottom: "B.SilkS",
  maskTop: "F.Mask",
  maskBottom: "B.Mask",
  pasteTop: "F.Paste",
  pasteBottom: "B.Paste",
  edge: "Edge.Cuts",
  courtyardTop: "F.CrtYd",
  courtyardBottom: "B.CrtYd",
  fabTop: "F.Fab",
  fabBottom: "B.Fab",
};

export function toKicadLayer(id: LayerId): string {
  return LAYER_MAP[id];
}

const COPPER: ReadonlySet<LayerId> = new Set(
  LAYERS.filter((l) => l.kind === "copper").map((l) => l.id),
);

/** Header-block form: copper layers are `signal`, everything else `user`. */
export function toKicadLayerCanonical(id: LayerId): { name: string; type: string } {
  return { name: LAYER_MAP[id], type: COPPER.has(id) ? "signal" : "user" };
}

export interface KicadLayerHeaderEntry {
  ordinal: number;
  name: string;
  type: "signal" | "user";
  /** KiCad 8 user-facing alias, e.g. `F.Silkscreen` — emitted as a 4th token. */
  userName?: string;
}

// The standard non-copper set KiCad 8 expects in every board file — missing
// entries break the loader, so all of them are always present (even if empty).
const NON_COPPER: readonly KicadLayerHeaderEntry[] = [
  { ordinal: 32, name: "B.Adhes", type: "user", userName: "B.Adhesive" },
  { ordinal: 33, name: "F.Adhes", type: "user", userName: "F.Adhesive" },
  { ordinal: 34, name: "B.Paste", type: "user" },
  { ordinal: 35, name: "F.Paste", type: "user" },
  { ordinal: 36, name: "B.SilkS", type: "user", userName: "B.Silkscreen" },
  { ordinal: 37, name: "F.SilkS", type: "user", userName: "F.Silkscreen" },
  { ordinal: 38, name: "B.Mask", type: "user" },
  { ordinal: 39, name: "F.Mask", type: "user" },
  { ordinal: 40, name: "Dwgs.User", type: "user", userName: "User.Drawings" },
  { ordinal: 41, name: "Cmts.User", type: "user", userName: "User.Comments" },
  { ordinal: 42, name: "Eco1.User", type: "user", userName: "User.Eco1" },
  { ordinal: 43, name: "Eco2.User", type: "user", userName: "User.Eco2" },
  { ordinal: 44, name: "Edge.Cuts", type: "user" },
  { ordinal: 45, name: "Margin", type: "user" },
  { ordinal: 46, name: "B.CrtYd", type: "user", userName: "B.Courtyard" },
  { ordinal: 47, name: "F.CrtYd", type: "user", userName: "F.Courtyard" },
  { ordinal: 48, name: "B.Fab", type: "user" },
  { ordinal: 49, name: "F.Fab", type: "user" },
];

/** Full `(layers ...)` header table for a 2- or 4-layer stackup, ordinal order. */
export function layerHeaderEntries(stackup: 2 | 4): KicadLayerHeaderEntry[] {
  const copper: KicadLayerHeaderEntry[] =
    stackup === 4
      ? [
          { ordinal: 0, name: "F.Cu", type: "signal" },
          { ordinal: 1, name: "In1.Cu", type: "signal" },
          { ordinal: 2, name: "In2.Cu", type: "signal" },
          { ordinal: 31, name: "B.Cu", type: "signal" },
        ]
      : [
          { ordinal: 0, name: "F.Cu", type: "signal" },
          { ordinal: 31, name: "B.Cu", type: "signal" },
        ];
  return [...copper, ...NON_COPPER];
}
