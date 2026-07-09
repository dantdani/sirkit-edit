/**
 * 3D preview color palettes (PCB Stage 15) — PINNED data. Six fab-realistic
 * combos of mask color + surface finish. Default: green mask + HASL silver.
 */

import type { Palette } from "./types";

// Base color swatches (the pinned PALETTE data).
const FR4_YELLOW = 0xd7b64f; // bare substrate seen at board edges
const COPPER = 0xb87333;
const HASL = 0xd7d7d7;
const ENIG_GOLD = 0xd4af37;
const SILK_WHITE = 0xf5f5f5;
const MASK_GREEN = 0x006c3c;
const MASK_RED = 0x8f1a1a;
const MASK_BLUE = 0x102b70;
const MASK_BLACK = 0x111111;
const MASK_PURPLE = 0x511e5d;
const PLASTIC = 0x1c1c1e;
const BACKGROUND = 0x101013;

function palette(mask: number, pad: number): Palette {
  return {
    fr4: FR4_YELLOW,
    copper: COPPER,
    pad,
    silk: SILK_WHITE,
    mask,
    footprintPlastic: PLASTIC,
    refdesText: 0xffffff,
    background: BACKGROUND,
  };
}

export const PALETTES = {
  "green-hasl": palette(MASK_GREEN, HASL),
  "green-enig": palette(MASK_GREEN, ENIG_GOLD),
  "red-hasl": palette(MASK_RED, HASL),
  "blue-enig": palette(MASK_BLUE, ENIG_GOLD),
  "black-enig": palette(MASK_BLACK, ENIG_GOLD),
  "purple-enig": palette(MASK_PURPLE, ENIG_GOLD),
} as const satisfies Record<string, Palette>;

export type PaletteId = keyof typeof PALETTES;
export const DEFAULT_PALETTE_ID: PaletteId = "green-hasl";
