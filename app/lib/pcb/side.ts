// Layer mirroring helpers (PCB Stage 5) — what "the other side of the board"
// means for every layer. Bottom-side rendering, flip (F), and pad-layer
// resolution all route through here so the mapping exists exactly once.

import type { LayerId } from "./layers";
import type { Pad } from "./types";

// Paired layers swap; edge and inner copper are side-less and map to
// themselves (a flip never moves geometry to an inner layer).
const OPPOSITE: Readonly<Record<LayerId, LayerId>> = {
  copperTop: "copperBottom",
  copperBottom: "copperTop",
  in1: "in1",
  in2: "in2",
  silkTop: "silkBottom",
  silkBottom: "silkTop",
  maskTop: "maskBottom",
  maskBottom: "maskTop",
  pasteTop: "pasteBottom",
  pasteBottom: "pasteTop",
  courtyardTop: "courtyardBottom",
  courtyardBottom: "courtyardTop",
  fabTop: "fabBottom",
  fabBottom: "fabTop",
  edge: "edge",
};

/** The layer a feature lands on when its footprint flips sides. Involution. */
export function oppositeLayer(layer: LayerId): LayerId {
  return OPPOSITE[layer];
}

/**
 * The physical layers a pad occupies for an instance on `side`. Footprint
 * definitions are authored top-side; a bottom-side instance maps every pad
 * layer through `oppositeLayer`. THT pads (all four copper layers) are
 * invariant under this map — only the mask/paste/silk facing swaps.
 */
export function effectivePadLayers(pad: Pad, side: "top" | "bottom"): LayerId[] {
  if (side === "top") return [...pad.layers];
  return pad.layers.map(oppositeLayer);
}
