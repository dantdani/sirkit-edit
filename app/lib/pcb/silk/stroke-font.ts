// Silkscreen stroke font (PCB Stage 16).
//
// FONT CHOICE (documented deviation from the pinned "Newstroke" default,
// substitute explicitly allowed): **Hershey Simplex** ("futural") — public
// domain, single-stroke, the classic plotter font with the same aesthetic as
// KiCad's Newstroke (Newstroke is itself Hershey-derived). Extracting
// Newstroke means parsing a ~2 MB generated C++ file out of KiCad's source
// tree; the Simplex JHF source is 3.5 KB, committed at
// scripts/assets/futural.jhf and converted by scripts/gen-silk-font.ts into
// hershey-simplex.json (10.5 KB — budget was < 30 KB).
//
// Glyph table: ASCII 32–126. Integer font units; x=0 at the glyph's left
// bound, y=0 at the BASELINE, +y down (the PCB convention); cap top at
// y = −capHeight. Unknown characters fall back to '?'.

import fontJson from "./hershey-simplex.json";

export interface StrokeGlyph {
  /** Advance width in font units. */
  a: number;
  /** Polylines of [x, y] font-unit points. */
  s: number[][][];
}

interface StrokeFont {
  name: string;
  capHeight: number;
  glyphs: Record<string, StrokeGlyph>;
}

const FONT = fontJson as unknown as StrokeFont;

/** Cap height in font units — `heightNm / CAP_HEIGHT_UNITS` is the scale. */
export const CAP_HEIGHT_UNITS: number = FONT.capHeight;

const FALLBACK: StrokeGlyph = FONT.glyphs["?"];

export function glyphFor(char: string): StrokeGlyph {
  return FONT.glyphs[char] ?? FALLBACK;
}

/** Total advance of a string in font units. */
export function textAdvanceUnits(text: string): number {
  let w = 0;
  for (const ch of text) w += glyphFor(ch).a;
  return w;
}
