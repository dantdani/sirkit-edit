/**
 * Physical layer heights for the 3D preview (PCB Stage 15) — PINNED constants.
 * Fixed fab-typical values; NOT user-facing (fab specs are a Stage 12/14
 * rules concern). The substrate spans z ∈ [0, 1.6] mm; top-side layers stack
 * upward from 1.6, bottom-side layers stack downward from 0.
 */

export const LAYER_HEIGHTS_MM = {
  substrate: 1.6,
  copper: 0.035, // 1 oz
  mask: 0.025,
  silk: 0.015,
  footprintPlastic: 1.0,
} as const;

export interface LayerSlab {
  /** Bottom face of the slab, mm. */
  zMm: number;
  heightMm: number;
}

export type StackupKey =
  | "silkBottom"
  | "maskBottom"
  | "copperBottom"
  | "in2"
  | "in1"
  | "copperTop"
  | "maskTop"
  | "silkTop";

/**
 * Z-stackup, bottom→top:
 *   [silk B][mask B][copper B][ FR4 core 1.6 mm ][copper F][mask F][silk F]
 * For 4-layer boards the inner coppers sit embedded at 1/3 and 2/3 of the
 * core (they exist in the map for 2-layer too — callers just don't build
 * geometry for them).
 */
export function zStackup(is4Layer: boolean): Record<StackupKey, LayerSlab> {
  const { substrate, copper, mask, silk } = LAYER_HEIGHTS_MM;
  void is4Layer; // inner positions are constant; the flag documents intent at call sites
  return {
    silkBottom: { zMm: -copper - mask - silk, heightMm: silk },
    maskBottom: { zMm: -copper - mask, heightMm: mask },
    copperBottom: { zMm: -copper, heightMm: copper },
    in2: { zMm: substrate / 3 - copper / 2, heightMm: copper },
    in1: { zMm: (substrate * 2) / 3 - copper / 2, heightMm: copper },
    copperTop: { zMm: substrate, heightMm: copper },
    maskTop: { zMm: substrate + copper, heightMm: mask },
    silkTop: { zMm: substrate + copper + mask, heightMm: silk },
  };
}
