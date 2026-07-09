/**
 * 4-layer plane helper (PCB Stage 11). A "GND plane on Inner 1" is nothing
 * but a zone whose polygon is the board outline — no separate model. The
 * caller dispatches the result through an `AddZone` command; `useZoneFills`
 * pours it on the next tick (`dirty: true`).
 */

import type { PcbBoard, Zone } from "../types";
import type { LayerId } from "../layers";
import { COPPER_LAYERS } from "../layers";
import { outlinePolygon } from "./geometry";

let planeSeq = 0;
const planeSalt = Math.random().toString(36).slice(2, 8);

/** Copper layer only ("copperTop" | "in1" | "in2" | "copperBottom"). */
export function makePlaneZone(
  board: PcbBoard,
  layer: LayerId,
  netId: number,
  options?: {
    appearance?: "solid" | "hatched";
    connection?: "solid" | "thermal";
    id?: string;
  },
): Zone {
  if (!COPPER_LAYERS.includes(layer)) {
    throw new Error(`makePlaneZone: ${layer} is not a copper layer`);
  }
  planeSeq += 1;
  return {
    id: options?.id ?? `zone-plane-${planeSalt}-${planeSeq}`,
    layer,
    netId,
    polygon: outlinePolygon(board.outline),
    appearance: options?.appearance ?? "solid",
    connection: options?.connection ?? "thermal",
    fill: [],
    dirty: true,
  };
}
